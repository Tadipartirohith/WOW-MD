import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import { Permission, can } from '../lib/permissions';
import IdentityPanel from '../components/IdentityPanel';
import { formatDate } from '../lib/dates';

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
 * Saved details are shown as saved details, with a separate Edit action. It
 * looks like a small thing and it is the reported defect: a page that stays an
 * editable form after saving gives no sign that anything was stored. People
 * filled it in, pressed save, saw the same boxes with the same text, and
 * concluded it had not worked — which is worse than losing the data outright,
 * because they then type it again.
 *
 * Reading back what the *server* returned, rather than what was typed, is the
 * other half: it is the only way the screen can tell you the difference between
 * "saved" and "sent".
 */
export default function Profile() {
  const qc = useQueryClient();
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const hasBiodata = can(permissions, Permission.MATCH_BROWSE);

  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/users/me')).data,
    retry: false,
  });

  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // A profile with nothing on it opens straight into the form; there is
  // nothing to read back yet.
  const blank = Boolean(data && !data.gender && !data.city && !data.dateOfBirth);
  useEffect(() => {
    if (blank) setEditing(true);
  }, [blank]);

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
      setEditing(false);
      setNotice('Saved. This is what we hold for you now.');
    } catch (err) {
      setError(apiMessage(err, 'Your profile could not be saved.'));
    }
  }

  const set = (key: keyof typeof empty) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="card space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-brand-dark">Your Profile</h1>
            <p className="text-sm text-gray-600">
              Your account details. {hasBiodata && 'The biodata families see lives separately.'}
            </p>
          </div>
          {!editing && data && (
            <button className="btn-outline" onClick={() => setEditing(true)}>
              Edit profile
            </button>
          )}
        </div>

        {notice && <p className="rounded bg-green-50 p-2 text-sm text-green-700">{notice}</p>}
        {error && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}
        {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

        {/*
          Read back from the server's own response, not from the form state, so
          "saved" means saved rather than sent.
        */}
        {!editing && data && (
          <dl className="divide-y text-sm">
            <Saved label="Name">{data.displayName}</Saved>
            <Saved label="Gender">{data.gender}</Saved>
            <Saved label="Date of birth">
              {data.dateOfBirth ? formatDate(data.dateOfBirth) : null}
            </Saved>
            <Saved label="City">{data.city}</Saved>
            <Saved label="Alternate mobile">{data.contactPhone}</Saved>
            <Saved label="Address">{data.address}</Saved>
            <Saved label="About you">{data.bio}</Saved>
          </dl>
        )}

        {editing && (
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm">
              <span className="text-gray-700">Name</span>
              <input
                className="input mt-1"
                value={form.displayName}
                onChange={set('displayName')}
                required
              />
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
                <span className="mt-1 block text-xs text-gray-500">
                  A second number. The one you sign in with is under Security.
                </span>
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

            <div className="flex flex-wrap gap-2">
              <button className="btn">Save profile</button>
              {!blank && (
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => {
                    setEditing(false);
                    setError('');
                    setNotice('');
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        )}
      </div>

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

/**
 * One saved value.
 *
 * An empty one says "not set" rather than rendering nothing — a blank row reads
 * as a rendering failure, and the whole point of this view is to be believed.
 */
function Saved({ label, children }: { label: string; children: ReactNode }) {
  const empty_ = children === null || children === undefined || children === '';
  return (
    <div className="flex gap-3 py-2">
      <dt className="w-40 shrink-0 text-gray-500">{label}</dt>
      <dd className={empty_ ? 'text-gray-400' : 'font-medium text-gray-900'}>
        {empty_ ? 'Not set' : children}
      </dd>
    </div>
  );
}
