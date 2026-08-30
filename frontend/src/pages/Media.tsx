import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import PhotoUploader from '../components/PhotoUploader';

interface Album {
  id: string;
  title: string;
  isPublic: boolean;
  shareToken: string;
  itemCount: number;
  coverUrl: string | null;
  shareUrl: string | null;
  createdAt: string;
}

interface Item {
  id: string;
  url: string;
  type: string;
  caption: string | null;
}

/**
 * The wedding album.
 *
 * This screen used to be two lists and a box for pasting an image URL, which
 * meant a couple had to upload their photographs somewhere else first and copy
 * links back in — and the photographs then rendered as the links themselves,
 * in grey text. In practice nobody used it, which is not surprising: it was a
 * bookmark manager with the word "memories" at the top.
 *
 * What it needs to be is a gallery. Albums are cards with a cover and a count;
 * a photograph is chosen from the device and goes straight to storage; and
 * what you see is the picture.
 */
export default function Media() {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const { data: albums = [], isLoading } = useQuery<Album[]>({
    queryKey: ['albums'],
    queryFn: async () => (await api.get('/media/albums')).data,
  });

  const open = albums.find((a) => a.id === openId) ?? null;

  const { data: items = [] } = useQuery<Item[]>({
    queryKey: ['album-items', openId],
    queryFn: async () => (await api.get(`/media/albums/${openId}/items`)).data,
    enabled: Boolean(openId),
  });

  async function run(fn: () => Promise<unknown>, keys: unknown[][]) {
    setError('');
    try {
      await fn();
      keys.forEach((key) => qc.invalidateQueries({ queryKey: key }));
    } catch (err) {
      setError(apiMessage(err));
    }
  }

  async function createAlbum(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await run(() => api.post('/media/albums', { title: title.trim(), isPublic }), [['albums']]);
    setTitle('');
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Media and Memories</h1>
        <p className="text-sm text-gray-600">
          Photographs from the wedding, kept together. An album you make public gets a link you can
          send to anyone — they do not need an account to open it.
        </p>
      </div>

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      <form onSubmit={createAlbum} className="card flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <label className="label">New album</label>
          <input
            className="input"
            placeholder="Mehendi, Reception, The morning of…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
          />
          Anyone with the link can see it
        </label>
        <button className="btn" disabled={!title.trim()}>
          Create album
        </button>
      </form>

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

      {/*
        The empty state says what to do rather than that there is nothing. "No
        albums yet" is a statement of the obvious to somebody looking at an
        empty screen.
      */}
      {!isLoading && albums.length === 0 && (
        <div className="card p-8 text-center">
          <p className="font-medium text-gray-800">No albums yet</p>
          <p className="mt-1 text-sm text-gray-500">
            Start one for each part of the wedding — the mehendi, the ceremony, the reception. You
            can add photographs straight from your phone.
          </p>
        </div>
      )}

      {albums.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {albums.map((a) => (
            <button
              key={a.id}
              onClick={() => setOpenId(a.id === openId ? null : a.id)}
              className={`card overflow-hidden p-0 text-left transition hover:shadow-md ${
                a.id === openId ? 'ring-2 ring-brand' : ''
              }`}
            >
              <div className="flex h-36 items-center justify-center bg-gray-100">
                {a.coverUrl ? (
                  <img
                    src={a.coverUrl}
                    alt=""
                    className="h-36 w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="text-sm text-gray-400">Nothing in it yet</span>
                )}
              </div>
              <div className="p-3">
                <p className="font-medium text-gray-900">{a.title}</p>
                <p className="text-xs text-gray-500">
                  {a.itemCount} photo{a.itemCount === 1 ? '' : 's'}
                  {a.isPublic ? ' · shared by link' : ' · private'}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-gray-900">{open.title}</h2>
              <p className="text-xs text-gray-500">
                {open.itemCount} photo{open.itemCount === 1 ? '' : 's'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {open.shareUrl && (
                <button
                  className="btn-outline"
                  onClick={() => {
                    void navigator.clipboard?.writeText(open.shareUrl!);
                    setCopied(open.id);
                  }}
                >
                  {copied === open.id ? 'Link copied' : 'Copy share link'}
                </button>
              )}
              <PhotoUploader
                label="Add photos"
                onUploaded={(url) =>
                  void run(() => api.post(`/media/albums/${open.id}/items`, { url, type: 'image' }), [
                    ['album-items', open.id],
                    ['albums'],
                  ])
                }
              />
              <button
                className="btn-outline"
                onClick={() => {
                  // Deleting an album takes its photographs with it, so it asks
                  // — this is the one action on the page that cannot be undone.
                  if (!window.confirm(`Delete "${open.title}" and its ${open.itemCount} photo(s)?`)) {
                    return;
                  }
                  void run(() => api.delete(`/media/albums/${open.id}`), [['albums']]);
                  setOpenId(null);
                }}
              >
                Delete album
              </button>
            </div>
          </div>

          {items.length === 0 && (
            <p className="rounded bg-gray-50 p-6 text-center text-sm text-gray-500">
              Nothing here yet. Add photographs from your phone or computer — they upload straight
              to storage, so a large one does not have to wait on the app.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((it) => (
              <div key={it.id} className="group relative">
                <img
                  src={it.url}
                  alt={it.caption ?? ''}
                  className="h-32 w-full rounded object-cover"
                  loading="lazy"
                />
                <button
                  className="absolute right-1 top-1 rounded bg-surface/90 px-2 py-0.5 text-xs text-gray-700 opacity-0 transition group-hover:opacity-100 focus:opacity-100"
                  onClick={() =>
                    void run(() => api.delete(`/media/albums/${open.id}/items/${it.id}`), [
                      ['album-items', open.id],
                      ['albums'],
                    ])
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
