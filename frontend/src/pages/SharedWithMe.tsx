import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import BiodataCard, { Biodata } from '../components/BiodataCard';
import ProfileSelector from '../components/ProfileSelector';

interface Sharer {
  agencyName: string | null;
  city: string | null;
  contactPhone: string | null;
  email: string | null;
}

interface SharedRow {
  shareId: string;
  sharedAt: string;
  message: string | null;
  sharedBy: Sharer | null;
  profile: Biodata;
}

/**
 * The receiving end of circulation: biodata other agencies have passed to you.
 *
 * Two things were missing and they were the same thing. The card said "Via an
 * agent" and stopped — on a screen whose entire job is deciding whether to take
 * a stranger's client seriously, the agency behind the share is the most useful
 * fact on it, and it was the one fact absent. And there was nothing to *do*
 * with a shared profile: the page's advice was to go to Matches, pick the
 * client you had in mind, and find the profile again from there.
 *
 * Both are fixed by the same idea — the actions belong where the profile is.
 * Pick the client once, and every card can be acted on.
 */
export default function SharedWithMe() {
  const qc = useQueryClient();
  const [actingAs, setActingAs] = useState('');
  const [error, setError] = useState('');
  const [sentFor, setSentFor] = useState<string[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['shared-with-me'],
    queryFn: async () => (await api.get('/circulation/shared-with-me')).data as SharedRow[],
    retry: false,
  });

  /**
   * The other half of the decision.
   *
   * With only "Send interest" on the card, an agent who had looked at a profile
   * and decided against it had nowhere to put that — so the card stayed, and
   * the list grew into a pile of profiles already ruled out. Dismissing is
   * private to this side: the profile is untouched and the agency that shared
   * it is never told.
   */
  async function ignore(row: SharedRow) {
    setError('');
    try {
      await api.put(`/circulation/shared-with-me/${row.shareId}/ignore`);
      qc.invalidateQueries({ queryKey: ['shared-with-me'] });
    } catch (err) {
      setError(apiMessage(err));
    }
  }

  async function sendInterest(row: SharedRow) {
    setError('');
    try {
      await api.post('/matches/interest', {
        toProfileId: row.profile.id,
        fromProfileId: actingAs,
      });
      setSentFor((list) => [...list, row.shareId]);
      qc.invalidateQueries({ queryKey: ['interest-board'] });
    } catch (err) {
      setError(apiMessage(err));
    }
  }

  const rows = data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Shared With Me</h1>
        <p className="text-sm text-gray-500">
          Biodata other agencies have circulated to you. Pick the client you have in mind and you
          can act on any of these without leaving the page.
        </p>
      </div>

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      {rows.length > 0 && (
        <div className="card">
          <ProfileSelector
            value={actingAs}
            onChange={setActingAs}
            label="Acting for which client"
          />
          {!actingAs && (
            <p className="mt-1 text-xs text-gray-500">
              An interest is sent <em>from</em> one of your clients, so pick which one first.
            </p>
          )}
        </div>
      )}

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

            {/*
              Who sent it. The name of the agency is what tells a receiving
              agent whether this is somebody they know, and it was the one
              thing the card did not say.
            */}
            <div className="rounded bg-gray-50 p-2 text-xs text-gray-600">
              <p>
                <span className="text-gray-400">Shared by </span>
                <span className="font-medium text-gray-800">
                  {row.sharedBy?.agencyName ?? row.sharedBy?.email ?? 'an agent'}
                </span>
                {row.sharedBy?.city && <span className="text-gray-400"> · {row.sharedBy.city}</span>}
              </p>
              {row.sharedBy?.contactPhone && (
                <p className="text-gray-500">{row.sharedBy.contactPhone}</p>
              )}
              <p className="text-gray-400">
                {new Date(row.sharedAt).toLocaleDateString()}
              </p>
            </div>

            {row.message && (
              <p className="rounded bg-brand-light p-2 text-sm text-brand-dark">“{row.message}”</p>
            )}

            <div className="flex flex-wrap gap-2">
              {sentFor.includes(row.shareId) ? (
                <span className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
                  Interest sent
                </span>
              ) : (
                <button
                  className="btn"
                  disabled={!actingAs}
                  title={actingAs ? undefined : 'Pick a client first'}
                  onClick={() => void sendInterest(row)}
                >
                  Send interest
                </button>
              )}
              {!sentFor.includes(row.shareId) && (
                <button
                  className="btn-outline"
                  title="Removes it from this list. The agency that shared it is not told."
                  onClick={() => void ignore(row)}
                >
                  Ignore
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
