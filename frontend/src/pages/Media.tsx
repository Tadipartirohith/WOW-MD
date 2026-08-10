import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

interface Album { id: string; title: string; isPublic: boolean; shareToken: string }

export default function Media() {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [url, setUrl] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const { data: albums } = useQuery({ queryKey: ['albums'], queryFn: async () => (await api.get('/media/albums')).data as Album[] });
  const { data: items } = useQuery({
    queryKey: ['album-items', selected],
    queryFn: async () => (await api.get(`/media/albums/${selected}/items`)).data,
    enabled: !!selected,
  });

  async function createAlbum(e: FormEvent) {
    e.preventDefault();
    await api.post('/media/albums', { title, isPublic });
    setTitle('');
    qc.invalidateQueries({ queryKey: ['albums'] });
  }
  async function addItem(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    await api.post(`/media/albums/${selected}/items`, { url, type: 'image' });
    setUrl('');
    qc.invalidateQueries({ queryKey: ['album-items', selected] });
  }

  const shareLink = (t: string) => `${window.location.origin}/album/${t}`;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-brand-dark">Media and Memories</h1>

      <form onSubmit={createAlbum} className="card flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <label className="label">New album</label>
          <input className="input" placeholder="Album title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /> Public
        </label>
        <button className="btn">Create album</button>
      </form>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <h2 className="mb-2 font-semibold">Your albums</h2>
          {(albums ?? []).map((a) => (
            <div key={a.id} className="mb-2 rounded border border-gray-200 p-2">
              <button onClick={() => setSelected(a.id)} className="block text-left font-medium">{a.title}</button>
              {a.isPublic && <p className="break-all text-xs text-brand">{shareLink(a.shareToken)}</p>}
            </div>
          ))}
          {!albums?.length && <p className="text-sm text-gray-400">No albums yet.</p>}
        </div>
        <div className="card">
          <h2 className="mb-2 font-semibold">Photos {selected ? '' : '(select an album)'}</h2>
          {selected && (
            <form onSubmit={addItem} className="mb-3 flex gap-2">
              <input className="input" placeholder="Image URL" value={url} onChange={(e) => setUrl(e.target.value)} required />
              <button className="btn">Add</button>
            </form>
          )}
          {selected && (items ?? []).map((it: { id: string; url: string }) => (
            <p key={it.id} className="break-all text-sm text-gray-600">{it.url}</p>
          ))}
        </div>
      </div>
    </div>
  );
}
