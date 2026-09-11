import { FormEvent, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';

/**
 * Where a provider's money leaves escrow to.
 *
 * Lives on Accounts alongside the rest of the payment picture (EZ1-I100) rather
 * than inside My Business, which is only about the shop window.
 *
 * Takes the whole endpoint rather than an id, because the two providers
 * address their listing differently: a vendor may own several and names the
 * one being paid, a planner has exactly one and says "me" (council round 2).
 */
export default function PayoutAccount({
  endpoint,
  current,
}: {
  endpoint: string;
  current: string | null;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState(current ?? '');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => setValue(current ?? ''), [current]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      await api.put(endpoint, { payoutAccountId: value.trim() });
      await qc.invalidateQueries({ queryKey: ['my-listing'] });
      await qc.invalidateQueries({ queryKey: ['earnings'] });
      await qc.invalidateQueries({ queryKey: ['payout-account'] });
      setEditing(false);
      setNotice(
        value.trim()
          ? 'Saved. Anything already owed to you goes out on the next payout run.'
          : 'Cleared. Payouts will be held until you add an account.',
      );
    } catch (err) {
      setError(apiMessage(err, 'That could not be saved.'));
    }
  }

  return (
    <div className="card space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="section-title">Payout account</h2>
          <p className="text-sm text-gray-600">
            Where money leaves escrow to. Until this is set, what you have earned is held as owed
            rather than paid.
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-1 text-xs ${
            current ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
          }`}
        >
          {current ? 'Ready' : 'Not set up'}
        </span>
      </div>

      {error && <p className="alert-critical">{error}</p>}
      {notice && <p className="rounded-sm bg-emerald-50 p-2 text-sm text-emerald-700">{notice}</p>}

      {!editing ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className={current ? 'font-medium text-gray-900' : 'text-gray-400'}>
            {current ?? 'No payout account'}
          </span>
          <button className="btn-outline" onClick={() => setEditing(true)}>
            {current ? 'Change' : 'Add one'}
          </button>
        </div>
      ) : (
        <form onSubmit={save} className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="text-gray-700">Linked account</span>
            <input
              className="input mt-1"
              placeholder="acc_XXXXXXXXXXXX"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <span className="mt-1 block text-xs text-gray-500">
              From your payment gateway, once your onboarding has cleared. Leave it blank to stop
              payouts.
            </span>
          </label>
          <button className="btn">Save</button>
          <button type="button" className="btn-outline" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
