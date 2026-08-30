import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, apiMessage } from '../lib/api';

interface ClaimRequest {
  id: string;
  message: string | null;
  createdAt: string;
  requestedBy: string;
  profile: {
    id: string;
    displayName: string;
    city: string | null;
    photoCount: number;
  } | null;
}

/**
 * An agency asking to hand over a profile it built for you.
 *
 * This appears unprompted, so it has to explain itself in full: somebody who
 * signed up an hour ago has no idea why a stranger's agency is offering them a
 * profile, and the honest answer — they took your family's details at their
 * office before you signed up — is also the reassuring one.
 *
 * Renders nothing at all when there is nothing waiting, which is almost always.
 */
export default function ClaimRequests() {
  const qc = useQueryClient();
  const [error, setError] = useState('');

  const { data = [] } = useQuery<ClaimRequest[]>({
    queryKey: ['claim-requests'],
    queryFn: async () => (await api.get('/profile-claims')).data,
    retry: false,
  });

  if (data.length === 0) return null;

  async function respond(id: string, action: 'approve' | 'decline') {
    setError('');
    try {
      await api.put(`/profile-claims/${id}/${action}`, {});
      qc.invalidateQueries({ queryKey: ['claim-requests'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      setError(apiMessage(err, 'That could not be completed.'));
    }
  }

  return (
    <div className="card space-y-3 border-brand/40">
      <div>
        <h2 className="section-title">
          {data.length === 1 ? 'A profile is waiting for you' : 'Profiles are waiting for you'}
        </h2>
        <p className="text-sm text-gray-600">
          An agency built this from details your family gave them, before you signed up. Accepting
          makes it yours. They lose the ability to edit it, and you can change anything on it.
        </p>
      </div>

      {error && <p className="alert-critical">{error}</p>}

      <div className="divide-y">
        {data.map((request) => (
          <div key={request.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div>
              <p className="font-medium text-gray-900">
                {request.profile?.displayName ?? 'A profile'}
              </p>
              <p className="text-sm text-gray-500">
                From {request.requestedBy}
                {request.profile?.city ? ` · ${request.profile.city}` : ''}
                {request.profile?.photoCount
                  ? ` · ${request.profile.photoCount} photo${
                      request.profile.photoCount === 1 ? '' : 's'
                    }`
                  : ''}
              </p>
              {request.message && (
                <p className="mt-1 rounded-sm bg-gray-50 p-2 text-sm text-gray-700">
                  “{request.message}”
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button className="btn" onClick={() => respond(request.id, 'approve')}>
                Accept
              </button>
              <button className="btn-outline" onClick={() => respond(request.id, 'decline')}>
                Not mine
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
