import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import BiodataCard, { Biodata } from '../components/BiodataCard';

interface SharedRow {
  shareId: string;
  sharedAt: string;
  message: string | null;
  profile: Biodata;
}

/**
 * The receiving end of circulation: biodata other agencies (or a family's own
 * agent) have passed to you.
 *
 * Read-only by design. Holding a shared profile lets you assess the match and
 * come back with a proposal; it never lets you edit it or act as it.
 */
export default function SharedWithMe() {
  const { data, isLoading } = useQuery({
    queryKey: ['shared-with-me'],
    queryFn: async () => (await api.get('/circulation/shared-with-me')).data as SharedRow[],
    retry: false,
  });

  const rows = data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-brand-dark">Shared With Me</h1>
        <p className="text-sm text-gray-500">
          Biodata other agencies have circulated to you. If one looks right for somebody on your
          books, send an interest from their profile — the two of you can then talk it through.
        </p>
      </div>

      {isLoading && <p className="text-gray-500">Loading...</p>}
      {!isLoading && rows.length === 0 && (
        <p className="card text-sm text-gray-500">
          Nothing has been shared with you yet. Other agencies will appear here when they send you a
          profile.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <div key={row.shareId} className="space-y-2">
            <BiodataCard profile={row.profile} />
            {row.message && (
              <p className="rounded bg-brand-light p-2 text-sm text-brand-dark">“{row.message}”</p>
            )}
            <p className="text-xs text-gray-400">
              Shared {new Date(row.sharedAt).toLocaleDateString()}
            </p>
          </div>
        ))}
      </div>

      {rows.length > 0 && (
        <p className="text-sm text-gray-500">
          To propose one of these, open{' '}
          <Link className="text-brand" to="/matches">
            Matches
          </Link>
          , pick the client you have in mind, and send an interest.
        </p>
      )}
    </div>
  );
}
