import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import { Permission, can } from '../lib/permissions';
import IdentityPanel from '../components/IdentityPanel';
import { formatDate } from '../lib/dates';
import { Loading } from '../components/ui/Feedback';

const empty = {
  displayName: '',
  gender: '',
  dateOfBirth: '',
  city: '',
  address: '',
  contactPhone: '',
  bio: '',
  managingFor: '',
  stewardRelation: '',
};

/**
 * How a family member is related to the person whose match they are looking
 * for. A closed list, because free text produced forty spellings of "father"
 * and none of them could be matched on — with room after "Other" for the
 * distinctions that matter here, like a maternal uncle.
 */
const STEWARD_RELATIONS = ['Self', 'Parent', 'Sibling', 'Relative', 'Friend', 'Other'];

const MANAGING_FOR_LABEL: Record<string, string> = { bride: 'Bride', groom: 'Groom' };

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
  /*
   * Only a steward is asked these. A bride filling in her own profile has no
   * answer to "who are you managing this for", and asking anyway is how a form
   * teaches people to ignore it.
   */
  const isSteward = can(permissions, Permission.ACT_ON_BEHALF);

  /*
   * An agency's own profile is not a biodata.
   *
   * ACT_ON_BEHALF is held by a family member and by an agent alike — that is
   * how a father runs his daughter's profile — so it cannot tell the two
   * apart, and this page was asking a marriage agency which of Bride or Groom
   * it was and what its relationship to itself was. Their date of birth and
   * gender were asked for the same reason and are equally beside the point:
   * nobody is matched against the agency.
   *
   * A family member is a client as well as a steward, so all of it stays for
   * them. AGENCY_MANAGE is the capability that separates the two.
   */
  const isAgency = can(permissions, Permission.AGENCY_MANAGE);
  const stewardFields = isSteward && !isAgency;

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
      managingFor: data.managingFor ?? '',
      stewardRelation: data.stewardRelation ?? '',
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
      // An agency is not asked for these, so it does not send them either.
      // Leaving them in the payload would keep resubmitting whatever stale
      // value the form was seeded with, from fields nobody can see.
      const fields = isAgency
        ? (['city', 'address', 'contactPhone', 'bio'] as const)
        : ([
            'gender',
            'dateOfBirth',
            'city',
            'address',
            'contactPhone',
            'bio',
            'managingFor',
            'stewardRelation',
          ] as const);
      for (const key of fields) {
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
          {/*
            The photograph, which this page never showed.

            A photo added on the biodata was reported as "not reflecting in the
            profile", and it was not — there was no image on this screen at
            all, so there was nowhere for it to reflect to. Read from the same
            /users/me the rest of this page uses, so it cannot drift from what
            the biodata saved.
          */}
          <div className="flex items-start gap-3">
            {data?.primaryPhotoUrl || data?.photos?.[0] ? (
              <img
                src={String(data.primaryPhotoUrl ?? data.photos[0])}
                alt=""
                className="h-16 w-16 shrink-0 rounded-full object-cover ring-1 ring-inset ring-gray-900/10"
              />
            ) : (
              <div
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full
                  bg-surface-sunken text-lg font-medium text-gray-400"
                aria-hidden
              >
                {(data?.displayName ?? '?').slice(0, 1).toUpperCase()}
              </div>
            )}
            <div>
            <h1 className="page-title">Your Profile</h1>
            <p className="page-subtitle">
              Your account details. {hasBiodata && 'The biodata families see lives separately.'}
            </p>
            </div>
          </div>
          {!editing && data && (
            <button className="btn-outline" onClick={() => setEditing(true)}>
              Edit profile
            </button>
          )}
        </div>

        {notice && <p className="alert-positive">{notice}</p>}
        {error && <p className="alert-critical">{error}</p>}
        {isLoading && <Loading rows={3} />}

        {/*
          Read back from the server's own response, not from the form state, so
          "saved" means saved rather than sent.
        */}
        {!editing && data && (
          <dl className="divide-y text-sm">
            <Saved label="Name">{data.displayName}</Saved>
            {!isAgency && (
              <>
                <Saved label="Gender">{data.gender}</Saved>
                <Saved label="Date of birth">
                  {data.dateOfBirth ? formatDate(data.dateOfBirth) : null}
                </Saved>
              </>
            )}
            <Saved label="City">{data.city}</Saved>
            {stewardFields && (
              <>
                <Saved label="Managing profile for">
                  {data.managingFor ? MANAGING_FOR_LABEL[data.managingFor] : null}
                </Saved>
                <Saved label="Relationship with the user">{data.stewardRelation}</Saved>
              </>
            )}
            <Saved label="Alternate mobile">{data.contactPhone}</Saved>
            <Saved label="Address">{data.address}</Saved>
            <Saved label="About you">{data.bio}</Saved>
          </dl>
        )}

        {/*
          The agency's own details — registration, address, approval — live on
          My Agency and are a different record from this one. Saying so is what
          keeps somebody from looking for them here.
        */}
        {isAgency && !editing && (
          <p className="text-sm text-gray-500">
            Your agency name, registration and address are on{' '}
            <Link className="text-brand-strong underline" to="/agency">
              My Agency
            </Link>
            . This page is you.
          </p>
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

            {/*
              Two fields, not one "User type: Bride/Groom".

              They are separate questions with separate answers: who the match
              is for, and what this person is to them. Collapsing them into a
              single dropdown made a father managing his daughter's profile pick
              between labels that described neither of them.
            */}
            {stewardFields && (
              <div className="grid gap-3 rounded-sm border border-gray-200 p-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-gray-700">Managing profile for</span>
                  <select
                    className="input mt-1"
                    value={form.managingFor}
                    onChange={set('managingFor')}
                  >
                    <option value="">Select…</option>
                    <option value="bride">Bride</option>
                    <option value="groom">Groom</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="text-gray-700">Relationship with the user</span>
                  <select
                    className="input mt-1"
                    value={
                      STEWARD_RELATIONS.includes(form.stewardRelation)
                        ? form.stewardRelation
                        : form.stewardRelation
                          ? 'Other'
                          : ''
                    }
                    onChange={set('stewardRelation')}
                  >
                    <option value="">Select…</option>
                    {STEWARD_RELATIONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  {(form.stewardRelation === 'Other' ||
                    (form.stewardRelation &&
                      !STEWARD_RELATIONS.includes(form.stewardRelation))) && (
                    <input
                      className="input mt-2"
                      placeholder="Maternal uncle, elder brother…"
                      value={form.stewardRelation === 'Other' ? '' : form.stewardRelation}
                      onChange={set('stewardRelation')}
                    />
                  )}
                </label>
              </div>
            )}

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
          </Link>.{' '}
          That is what gets circulated.
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
