import { FormEvent, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import { Permission, can } from '../lib/permissions';
import IdentityPanel from '../components/IdentityPanel';

const empty = {
  displayName: '',
  gender: '',
  dateOfBirth: '',
  city: '',
  address: '',
  contactPhone: '',
  bio: '',
};

/**
 * The account holder's own profile.
 *
 * Saving now refetches. Before, the mutation wrote and the cached copy stayed
 * as it was, so the next visit to this page redisplayed whatever had been there
 * before the edit — the change had in fact saved, but there was no way to tell
 * from the screen, which is worse than losing it outright.
 */
export default function Profile() {
  const qc = useQueryClient();
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const hasBiodata = can(permissions, Permission.MATCH_BROWSE);

  const { data } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/users/me')).data,
    retry: false,
  });

  const [form, setForm] = useState(empty);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!data) return;
    setForm({
      displayName: data.displayName ?? '',
      gender: data.gender ?? '',
      dateOfBirth: data.dateOfBirth ?? '',
      city: data.city ?? '',
      address: data.address ?? '',
      contactPhone: data.contactPhone ?? '',
      bio: data.bio ?? '',
    });
  }, [data]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      // Blank optional fields are omitted rather than sent as empty strings,
      // which the validators would reject as malformed rather than absent.
      const payload: Record<string, string> = { displayName: form.displayName };
      for (const key of ['gender', 'dateOfBirth', 'city', 'address', 'contactPhone', 'bio'] as const) {
        if (form[key]) payload[key] = form[key];
      }
      await api.put('/users/me/profile', payload);
      await qc.invalidateQueries({ queryKey: ['me'] });
      setNotice('Saved.');
    } catch (err) {
      setError(apiMessage(err, 'Your profile could not be saved.'));
    }
  }

  const set = (key: keyof typeof empty) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <form onSubmit={submit} className="card space-y-4">
        <div>
          <h1 className="text-xl font-bold text-brand-dark">Your Profile</h1>
          <p className="text-sm text-gray-600">
            Your account details. {hasBiodata && 'The biodata families see lives separately.'}
          </p>
        </div>

        {notice && <p className="rounded bg-green-50 p-2 text-sm text-green-700">{notice}</p>}
        {error && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}

        <label className="block text-sm">
          <span className="text-gray-700">Name</span>
          <input className="input mt-1" value={form.displayName} onChange={set('displayName')} required />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-gray-700">Gender</span>
            <select className="input mt-1" value={form.gender} onChange={set('gender')}>
              <option value="">Prefer not to say</option>
              <option value="Female">Female</option>
              <option value="Male">Male</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">Date of birth</span>
            <input
              className="input mt-1"
              type="date"
              value={form.dateOfBirth}
              onChange={set('dateOfBirth')}
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">City</span>
            <input className="input mt-1" value={form.city} onChange={set('city')} />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">Alternate mobile</span>
            <input
              className="input mt-1"
              placeholder="+919876543210"
              value={form.contactPhone}
              onChange={set('contactPhone')}
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="text-gray-700">Address</span>
          <textarea
            className="input mt-1"
            rows={2}
            maxLength={500}
            value={form.address}
            onChange={set('address')}
          />
        </label>

        <label className="block text-sm">
          <span className="text-gray-700">About you</span>
          <textarea
            className="input mt-1"
            rows={3}
            maxLength={2000}
            value={form.bio}
            onChange={set('bio')}
          />
        </label>

        <button className="btn">Save profile</button>
      </form>

      {hasBiodata && (
        <p className="card text-sm text-gray-600">
          Ready to be seen by other families?{' '}
          <Link className="text-brand underline" to="/biodata">
            Fill in your biodata
          </Link>{' '}
          — that is what gets circulated.
        </p>
      )}

      {data?.id && <IdentityPanel profileId={data.id} />}
    </div>
  );
}
