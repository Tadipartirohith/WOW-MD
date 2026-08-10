import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

interface Task {
  id: string;
  title: string;
  category: string;
  dueDate: string | null;
  status: string;
}
interface Plan {
  id: string;
  weddingDate: string;
}

export default function Planner() {
  const qc = useQueryClient();
  const [weddingDate, setWeddingDate] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const { data: plans } = useQuery({
    queryKey: ['plans'],
    queryFn: async () => (await api.get('/planner/plans')).data as Plan[],
  });

  const { data: timeline } = useQuery({
    queryKey: ['timeline', selected],
    queryFn: async () => (await api.get(`/planner/plan/${selected}/timeline`)).data,
    enabled: !!selected,
  });

  async function createPlan(e: FormEvent) {
    e.preventDefault();
    const { data } = await api.post('/planner/plan', { weddingDate });
    setSelected(data.id);
    qc.invalidateQueries({ queryKey: ['plans'] });
  }

  async function cycleStatus(task: Task) {
    const next = task.status === 'pending' ? 'in_progress' : task.status === 'in_progress' ? 'done' : 'pending';
    await api.put(`/planner/tasks/${task.id}/status`, { status: next });
    qc.invalidateQueries({ queryKey: ['timeline', selected] });
  }

  const tasks: Task[] = timeline?.tasks ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-brand-dark">Wedding Planner</h1>

      <form onSubmit={createPlan} className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Wedding date</label>
          <input className="input" type="date" value={weddingDate} onChange={(e) => setWeddingDate(e.target.value)} required />
        </div>
        <button className="btn">Generate timeline</button>
      </form>

      {plans && plans.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {plans.map((p) => (
            <button
              key={p.id}
              className={selected === p.id ? 'btn' : 'btn-outline'}
              onClick={() => setSelected(p.id)}
            >
              {p.weddingDate}
            </button>
          ))}
        </div>
      )}

      {tasks.length > 0 && (
        <div className="card divide-y">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium">{t.title}</p>
                <p className="text-xs text-gray-500">{t.category}, due {t.dueDate}</p>
              </div>
              <button
                onClick={() => cycleStatus(t)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  t.status === 'done'
                    ? 'bg-green-100 text-green-700'
                    : t.status === 'in_progress'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-gray-100 text-gray-600'
                }`}
              >
                {t.status}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
