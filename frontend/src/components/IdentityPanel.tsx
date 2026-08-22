import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';

interface IdentityView {
  profileId: string;
  idType: string | null;
  last4: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
}

const TYPES = [
  { value: 'aadhaar', label: 'Aadhaar' },
  { value: 'passport', label: 'Passport' },
  { value: 'voter_id', label: 'Voter ID' },
  { value: 'driving_licence', label: 'Driving licence' },
  { value: 'pan', label: 'PAN' },
];

/**
 * Identity on a profile.
 *
 * Worth being plain with people about what happens to the number, because the
 * honest answer is unusually reassuring: it is checked, hashed, and thrown
 * away. What survives is the last four digits and a fingerprint that can only
 * answer "is this the same document as that one?" — which is what stops one
 * person quietly running two profiles.
 */
export default function IdentityPanel({ profileId }: { profileId: string }) {
  const qc = useQueryClient();
  const [idType, setIdType] = useState('aadhaar');
  const [idNumber, setIdNumber] = useState('');
  const [error, setError] = useState('');

  const { data } = useQuery({
    queryKey: ['identity', profileId],
    queryFn: async () =>
      (await api.get(`/users/profiles/${profileId}/identity`)).data as IdentityView,
    retry: false,
    enabled: Boolean(profileId),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/users/profiles/${profileId}/identity`, { idType, idNumber });
      setIdNumber('');
      qc.invalidateQueries({ queryKey: ['identity', profileId] });
    } catch (err) {
      setError(apiMessage(err, 'That document could not be recorded.'));
    }
  }

  if (data?.submittedAt) {
    return (
      <div className="card space-y-1">
        <h2 className="font-semibold text-gray-900">Identity</h2>
        <p className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
          {/*
            Said as a badge rather than buried in a sentence: whether a document
            is merely on file or has actually been confirmed is the difference
            people are looking for when they open this.
          */}
          <span
            className={`rounded-full px-2 py-1 text-xs font-medium ${
              data.verifiedAt
                ? 'bg-emerald-50 text-emerald-800'
                : 'bg-amber-50 text-amber-800'
            }`}
          >
            {data.verifiedAt ? 'Verified' : 'Awaiting verification'}
          </span>
          {TYPES.find((t) => t.value === data.idType)?.label ?? data.idType} ending{' '}
          <strong>{data.last4}</strong>
        </p>
        <p className="text-sm text-gray-600">
          {data.verifiedAt
            ? 'Confirmed in person by a verification officer.'
            : 'On file. A verification officer confirms it against the document itself.'}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <div>
        <h2 className="font-semibold text-gray-900">Identity</h2>
        <p className="text-sm text-gray-600">
          One document, one profile — this is what keeps duplicates off the platform. The number
          itself is never stored: it is checked, turned into a fingerprint, and discarded. Only the
          last four digits are kept.
        </p>
      </div>

      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Document</label>
          <select className="input" value={idType} onChange={(e) => setIdType(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Number</label>
          <input
            className="input"
            value={idNumber}
            onChange={(e) => setIdNumber(e.target.value)}
            required
          />
        </div>
      </div>

      <button className="btn" disabled={idNumber.trim().length < 8}>
        Record this document
      </button>
    </form>
  );
}
