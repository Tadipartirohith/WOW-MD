import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export default function SharedAlbum() {
  const { token } = useParams();
  const { data, isError } = useQuery({
    queryKey: ['shared-album', token],
    queryFn: async () => (await api.get(`/media/shared/${token}`)).data,
    retry: false,
  });

  if (isError) return <div className="p-8 text-center text-gray-500">This shared album is not available.</div>;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="page-title mb-4">{data?.album?.title ?? 'Shared album'}</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {(data?.items ?? []).map((it: { id: string; url: string; caption?: string }) => (
          <div key={it.id} className="rounded-sm border border-gray-200 p-2">
            <p className="break-all text-xs text-gray-600">{it.url}</p>
            {it.caption && <p className="text-sm">{it.caption}</p>}
          </div>
        ))}
        {!data?.items?.length && <p className="text-sm text-gray-400">No photos in this album yet.</p>}
      </div>
    </div>
  );
}
