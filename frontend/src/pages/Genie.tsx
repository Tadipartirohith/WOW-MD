import { FormEvent, useState } from 'react';
import { api } from '../lib/api';

interface BudgetRow {
  category: string;
  percent: number;
  amount: number;
}

export default function Genie() {
  const [budget, setBudget] = useState('');
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');

  async function getBudget(e: FormEvent) {
    e.preventDefault();
    const { data } = await api.post('/ai/budget-insight', { totalBudget: Number(budget) });
    setRows(data.breakdown);
  }

  async function ask(e: FormEvent) {
    e.preventDefault();
    const { data } = await api.post('/ai/assistant', { question });
    setAnswer(data.answer);
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="card space-y-4">
        <h2 className="font-bold text-brand-dark">Budget Insights</h2>
        <form onSubmit={getBudget} className="flex items-end gap-3">
          <div className="flex-1">
            <label className="label">Total budget in Rs</label>
            <input className="input" type="number" value={budget} onChange={(e) => setBudget(e.target.value)} required />
          </div>
          <button className="btn">Analyse</button>
        </form>
        {rows.length > 0 && (
          <div className="divide-y">
            {rows.map((r) => (
              <div key={r.category} className="flex justify-between py-1.5 text-sm">
                <span>{r.category} ({r.percent}%)</span>
                <span className="font-medium">Rs {r.amount.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card space-y-4">
        <h2 className="font-bold text-brand-dark">Ask WOW Genie</h2>
        <form onSubmit={ask} className="space-y-2">
          <textarea className="input" rows={3} placeholder="e.g. How do I plan a 300-guest wedding in 6 months?" value={question} onChange={(e) => setQuestion(e.target.value)} />
          <button className="btn">Ask</button>
        </form>
        {answer && <p className="rounded bg-brand-light p-3 text-sm text-brand-dark">{answer}</p>}
      </div>
    </div>
  );
}
