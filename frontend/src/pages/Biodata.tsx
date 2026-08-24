import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import {
  ASSET_TYPE_LABEL,
  FAMILY_TYPE_LABEL,
  MARITAL_LABEL,
  MaritalStatus,
  OCCUPATION_LABEL,
  OccupationStatus,
  Permission,
  can,
} from '../lib/permissions';
import ProfileSelector from '../components/ProfileSelector';
import ProfilePhotos from '../components/ProfilePhotos';
import SavedBiodata from '../components/SavedBiodata';
import { formatDate } from '../lib/dates';

interface Section {
  section: string;
  complete: boolean;
  label: string;
}

interface Completion {
  profileId: string;
  complete: boolean;
  percent: number;
  sections: Section[];
  missing: string[];
}

/**
 * The two numbers, each labelled.
 *
 * They live in different places for good reasons — the primary is on the
 * account because it signs you in, the alternate is on the biodata because it
 * is usually the family's — but a page showing one without the other reads as
 * though the primary is missing.
 */
interface ContactBlock {
  primaryMobile: string | null;
  primaryMobileVerified: boolean;
  primaryMobileSource: 'account' | 'agency_record';
  alternateMobile: string | null;
  email: string | null;
}

interface Sibling {
  id: string;
  name: string;
  age: number | null;
  maritalStatus: MaritalStatus | null;
  qualification: string | null;
  profession: string | null;
}

interface Asset {
  id: string;
  type: string;
  location: string | null;
  area: string | null;
  estimatedValue: string | null;
  visible: boolean;
}

/**
 * The matrimonial biodata, section by section.
 *
 * Saved a section at a time on purpose. People fill this in over days, from a
 * phone, often with a relative reading answers out — a single form that only
 * commits at the end loses all of it the first time somebody closes the tab.
 */
export default function Biodata() {
  const qc = useQueryClient();
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const isSteward = can(permissions, Permission.ACT_ON_BEHALF);
  const isAgent = can(permissions, Permission.AGENCY_MANAGE);

  const [params, setParams] = useSearchParams();
  const [profileId, setProfileId] = useState(params.get('profileId') ?? '');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState('personal');

  // Individuals edit their own profile and never pick one.
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/users/me')).data,
    retry: false,
    enabled: !isAgent,
  });
  const targetId = profileId || (me?.id ?? '');

  useEffect(() => {
    if (profileId) setParams({ profileId }, { replace: true });
  }, [profileId, setParams]);

  const { data } = useQuery({
    queryKey: ['biodata', targetId],
    queryFn: async () => (await api.get(`/profiles/${targetId}/details`)).data,
    retry: false,
    enabled: Boolean(targetId),
  });

  const details = data?.details ?? {};
  const contact: ContactBlock | undefined = data?.contact;
  const completion: Completion | undefined = data?.completion;
  const siblings: Sibling[] = data?.siblings ?? [];
  const assets: Asset[] = data?.assets ?? [];

  async function save(section: string, body: unknown) {
    setError('');
    setNotice('');
    try {
      await api.put(`/profiles/${targetId}/details/${section}`, body);
      setNotice('Saved.');
      qc.invalidateQueries({ queryKey: ['biodata', targetId] });
    } catch (err) {
      setError(apiMessage(err, 'That section could not be saved.'));
    }
  }

  async function mutate(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ['biodata', targetId] });
    } catch (err) {
      setError(apiMessage(err, 'That did not work.'));
    }
  }

  if (isAgent && !profileId) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-brand-dark">Client biodata</h1>
        <ProfileSelector value={profileId} onChange={setProfileId} label="Client" />
        <p className="card text-sm text-gray-600">
          Pick a client to fill in their biodata. Everything here is what the other family will
          ask about, so a profile is not ready to circulate until it is complete.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-brand-dark">Biodata</h1>
          <p className="text-sm text-gray-600">
            Saved section by section — you can stop and come back.
          </p>
        </div>
        {isSteward && <ProfileSelector value={profileId} onChange={setProfileId} label="Client" />}
      </div>

      {completion && (
        <div className="card space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-gray-900">
              {completion.complete ? 'Complete' : `${completion.percent}% complete`}
            </p>
            {!completion.complete && (
              <p className="text-sm text-gray-600">
                {completion.missing.length} section{completion.missing.length === 1 ? '' : 's'} to go
              </p>
            )}
          </div>
          <div className="h-2 w-full overflow-hidden rounded bg-gray-100">
            <div
              className="h-full rounded bg-brand transition-all"
              style={{ width: `${completion.percent}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {completion.sections.map((s) => (
              <button
                key={s.section}
                onClick={() => setOpen(s.section)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  s.complete ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
                }`}
              >
                {s.complete ? '✓' : '•'} {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}
      {notice && <p className="rounded bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

      {/*
        Read-back first, forms after. A form full of your own answers looks
        exactly like a form you have not filled in yet, which is why people
        saved, saw the same boxes and concluded nothing had been stored.
      */}
      <Accordion title="Saved details" name="saved" open={open} setOpen={setOpen}>
        <SavedBiodata details={details} siblings={siblings} assets={assets} />
      </Accordion>

      <Accordion title="Photographs" name="photos" open={open} setOpen={setOpen}>
        {targetId ? (
          <ProfilePhotos profileId={targetId} />
        ) : (
          <p className="text-sm text-gray-400">Pick a profile first.</p>
        )}
      </Accordion>

      <Accordion title="Personal details" name="personal" open={open} setOpen={setOpen}>
        <PersonalForm initial={details} contact={contact} onSave={(b) => save('personal', b)} />
      </Accordion>

      <Accordion title="Religion and community" name="religion" open={open} setOpen={setOpen}>
        <ReligionForm initial={details} onSave={(b) => save('religion', b)} />
      </Accordion>

      <Accordion title="Horoscope" name="horoscope" open={open} setOpen={setOpen}>
        <HoroscopeForm initial={details} onSave={(b) => save('horoscope', b)} />
      </Accordion>

      <Accordion title="Marital status" name="marital" open={open} setOpen={setOpen}>
        <MaritalForm initial={details} onSave={(b) => save('marital', b)} />
      </Accordion>

      <Accordion title="Family" name="family" open={open} setOpen={setOpen}>
        <FamilyForm
          initial={details}
          siblings={siblings}
          assets={assets}
          onSave={(b) => save('family', b)}
          onAddSibling={(b) => mutate(() => api.post(`/profiles/${targetId}/details/siblings`, b))}
          onRemoveSibling={(id) =>
            mutate(() => api.delete(`/profiles/${targetId}/details/siblings/${id}`))
          }
          onAddAsset={(b) => mutate(() => api.post(`/profiles/${targetId}/details/assets`, b))}
          onRemoveAsset={(id) =>
            mutate(() => api.delete(`/profiles/${targetId}/details/assets/${id}`))
          }
        />
      </Accordion>

      <Accordion title="Education and occupation" name="education" open={open} setOpen={setOpen}>
        <EducationForm initial={details} onSave={(b) => save('education', b)} />
      </Accordion>

      <Accordion title="Partner preferences" name="preferences" open={open} setOpen={setOpen}>
        <PreferencesForm initial={details} onSave={(b) => save('preferences', b)} />
      </Accordion>

      <Accordion title="Identity verification" name="identity" open={open} setOpen={setOpen}>
        <AadhaarPanel profileId={targetId} />
      </Accordion>
    </div>
  );
}

function Accordion({
  title,
  name,
  open,
  setOpen,
  children,
}: {
  title: string;
  name: string;
  open: string;
  setOpen: (n: string) => void;
  children: ReactNode;
}) {
  const isOpen = open === name;
  return (
    <div className="card">
      <button
        className="flex w-full items-center justify-between text-left"
        onClick={() => setOpen(isOpen ? '' : name)}
      >
        <span className="font-semibold text-gray-900">{title}</span>
        <span className="text-gray-400">{isOpen ? '−' : '+'}</span>
      </button>
      {isOpen && <div className="mt-4">{children}</div>}
    </div>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-gray-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

type Draft = Record<string, unknown>;

function useDraft(initial: Draft, keys: string[]) {
  const [draft, setDraft] = useState<Draft>({});
  useEffect(() => {
    const next: Draft = {};
    for (const key of keys) next[key] = initial?.[key] ?? '';
    setDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initial), keys.join(',')]);

  const set = (key: string) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));
  return { draft, setDraft, set };
}

function PersonalForm({
  initial,
  contact,
  onSave,
}: {
  initial: Draft;
  contact?: ContactBlock;
  onSave: (b: Draft) => void;
}) {
  const keys = [
    'firstName',
    'lastName',
    'heightCm',
    'complexion',
    'nativePlace',
    'placeOfBirth',
    'communicationAddress',
    'alternateMobile',
  ];
  const { draft, set } = useDraft(initial, keys);

  function submit(e: FormEvent) {
    e.preventDefault();
    onSave({
      ...draft,
      heightCm: Number(draft.heightCm) || undefined,
      alternateMobile: draft.alternateMobile || undefined,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="First name" hint="What people call you">
          <input className="input mt-1" value={String(draft.firstName ?? '')} onChange={set('firstName')} required />
        </Field>
        {/*
          One name field. The two used to be separate — in much of India the
          house or gothram name and the family name are different words — but
          they were read as duplicates often enough that a single field is the
          clearer answer.
        */}
        <Field label="Last name" hint="Family name, as on your documents">
          <input className="input mt-1" value={String(draft.lastName ?? '')} onChange={set('lastName')} required />
        </Field>
        <Field label="Height (cm)">
          <input
            className="input mt-1"
            type="number"
            min={120}
            max={230}
            value={String(draft.heightCm ?? '')}
            onChange={set('heightCm')}
            required
          />
        </Field>
        <Field label="Complexion">
          <input className="input mt-1" value={String(draft.complexion ?? '')} onChange={set('complexion')} required />
        </Field>
        <Field label="Native place">
          <input className="input mt-1" value={String(draft.nativePlace ?? '')} onChange={set('nativePlace')} required />
        </Field>
        <Field label="Place of birth">
          <input className="input mt-1" value={String(draft.placeOfBirth ?? '')} onChange={set('placeOfBirth')} required />
        </Field>
        {/*
          The primary number lives on the account, not the biodata, so it is
          shown here rather than edited here. Without it the page appeared to
          have lost the main number entirely, which is what was reported.
        */}
        <Field
          label="Primary mobile"
          hint={
            contact?.primaryMobileSource === 'agency_record'
              ? 'Taken by the agency. Changes when the profile is claimed.'
              : 'Your sign-in number. Change it under Security.'
          }
        >
          <div className="input mt-1 flex items-center justify-between bg-gray-50">
            <span className={contact?.primaryMobile ? 'text-gray-900' : 'text-gray-400'}>
              {contact?.primaryMobile ?? 'Not on file'}
            </span>
            {contact?.primaryMobile && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  contact.primaryMobileVerified
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-amber-50 text-amber-800'
                }`}
              >
                {contact.primaryMobileVerified ? 'Verified' : 'Not verified'}
              </span>
            )}
          </div>
        </Field>
        <Field label="Alternate mobile" hint="Optional — often the family's number">
          <input
            className="input mt-1"
            inputMode="tel"
            value={String(draft.alternateMobile ?? '')}
            onChange={set('alternateMobile')}
          />
        </Field>
      </div>
      <Field label="Communication address">
        <textarea
          className="input mt-1"
          rows={2}
          value={String(draft.communicationAddress ?? '')}
          onChange={set('communicationAddress')}
          required
        />
      </Field>
      <button className="btn">Save personal details</button>
    </form>
  );
}

function ReligionForm({ initial, onSave }: { initial: Draft; onSave: (b: Draft) => void }) {
  const { draft, set } = useDraft(initial, [
    'religion',
    'caste',
    'subCaste',
    'motherTongue',
    'denomination',
  ]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...draft, denomination: draft.denomination || undefined });
      }}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Religion">
          <input className="input mt-1" value={String(draft.religion ?? '')} onChange={set('religion')} required />
        </Field>
        <Field label="Caste">
          <input className="input mt-1" value={String(draft.caste ?? '')} onChange={set('caste')} required />
        </Field>
        <Field label="Sub-caste">
          <input className="input mt-1" value={String(draft.subCaste ?? '')} onChange={set('subCaste')} required />
        </Field>
        <Field label="Mother tongue">
          <input className="input mt-1" value={String(draft.motherTongue ?? '')} onChange={set('motherTongue')} required />
        </Field>
        <Field label="Denomination / sect" hint="Only where the community uses one">
          <input className="input mt-1" value={String(draft.denomination ?? '')} onChange={set('denomination')} />
        </Field>
      </div>
      <button className="btn">Save religion details</button>
    </form>
  );
}

function HoroscopeForm({ initial, onSave }: { initial: Draft; onSave: (b: Draft) => void }) {
  const chart = (initial?.horoscope ?? {}) as Draft;
  const [available, setAvailable] = useState(Boolean(initial?.horoscopeAvailable));
  const [values, setValues] = useState<Draft>({});

  useEffect(() => {
    setAvailable(Boolean(initial?.horoscopeAvailable));
    setValues({
      rashi: chart.rashi ?? '',
      star: chart.star ?? '',
      padam: chart.padam ?? '',
      gothram: chart.gothram ?? '',
      kujaDosham: chart.kujaDosham ?? '',
      timeOfBirth: chart.timeOfBirth ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initial)]);

  const set = (k: string) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(
          available
            ? {
                horoscopeAvailable: true,
                ...Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '')),
              }
            : { horoscopeAvailable: false },
        );
      }}
      className="space-y-3"
    >
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={available}
          onChange={(e) => setAvailable(e.target.checked)}
        />
        <span>A horoscope is available</span>
      </label>
      <p className="text-xs text-gray-500">
        Answering &ldquo;no&rdquo; completes this section — plenty of families do not use one.
      </p>

      {available && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Rashi">
            <input className="input mt-1" value={String(values.rashi ?? '')} onChange={set('rashi')} required />
          </Field>
          <Field label="Star / Nakshatra">
            <input className="input mt-1" value={String(values.star ?? '')} onChange={set('star')} />
          </Field>
          <Field label="Padam">
            <input className="input mt-1" value={String(values.padam ?? '')} onChange={set('padam')} />
          </Field>
          <Field label="Gothram">
            <input className="input mt-1" value={String(values.gothram ?? '')} onChange={set('gothram')} />
          </Field>
          <Field label="Kuja Dosham">
            <select className="input mt-1" value={String(values.kujaDosham ?? '')} onChange={set('kujaDosham')}>
              <option value="">Not stated</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
              <option value="unknown">Unknown</option>
            </select>
          </Field>
          <Field label="Time of birth">
            <input className="input mt-1" type="time" value={String(values.timeOfBirth ?? '')} onChange={set('timeOfBirth')} />
          </Field>
        </div>
      )}
      <button className="btn">Save horoscope</button>
    </form>
  );
}

function MaritalForm({ initial, onSave }: { initial: Draft; onSave: (b: Draft) => void }) {
  const history = (initial?.maritalHistory ?? {}) as Draft;
  const [status, setStatus] = useState<MaritalStatus>(
    (initial?.maritalStatus as MaritalStatus) ?? 'never_married',
  );
  const [values, setValues] = useState<Draft>({});

  useEffect(() => {
    setStatus((initial?.maritalStatus as MaritalStatus) ?? 'never_married');
    setValues({
      marriageDate: history.marriageDate ?? '',
      divorceDate: history.divorceDate ?? '',
      yearsMarried: history.yearsMarried ?? '',
      hasChildren: history.hasChildren ?? false,
      boys: history.boys ?? '',
      girls: history.girls ?? '',
      childrenLivingWith: history.childrenLivingWith ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initial)]);

  const set = (k: string) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const body: Draft = { maritalStatus: status };
        if (status !== 'never_married') {
          if (values.marriageDate) body.marriageDate = values.marriageDate;
          if (values.divorceDate) body.divorceDate = values.divorceDate;
          if (values.yearsMarried) body.yearsMarried = Number(values.yearsMarried);
          body.hasChildren = Boolean(values.hasChildren);
          if (values.boys !== '') body.boys = Number(values.boys);
          if (values.girls !== '') body.girls = Number(values.girls);
          if (values.childrenLivingWith) body.childrenLivingWith = values.childrenLivingWith;
        }
        onSave(body);
      }}
      className="space-y-3"
    >
      <Field label="Marital status">
        <select
          className="input mt-1"
          value={status}
          onChange={(e) => setStatus(e.target.value as MaritalStatus)}
        >
          {Object.entries(MARITAL_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>

      {status !== 'never_married' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Marriage date">
            <input className="input mt-1" type="date" value={String(values.marriageDate ?? '')} onChange={set('marriageDate')} />
          </Field>
          <Field label="Divorce / separation date">
            <input className="input mt-1" type="date" value={String(values.divorceDate ?? '')} onChange={set('divorceDate')} />
          </Field>
          <Field label="Years married">
            <input className="input mt-1" type="number" min={0} value={String(values.yearsMarried ?? '')} onChange={set('yearsMarried')} />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-3">
            <input
              type="checkbox"
              checked={Boolean(values.hasChildren)}
              onChange={(e) => setValues((v) => ({ ...v, hasChildren: e.target.checked }))}
            />
            <span>There are children</span>
          </label>
          {Boolean(values.hasChildren) && (
            <>
              <Field label="Boys">
                <input className="input mt-1" type="number" min={0} value={String(values.boys ?? '')} onChange={set('boys')} />
              </Field>
              <Field label="Girls">
                <input className="input mt-1" type="number" min={0} value={String(values.girls ?? '')} onChange={set('girls')} />
              </Field>
              <Field label="Living with">
                <input className="input mt-1" value={String(values.childrenLivingWith ?? '')} onChange={set('childrenLivingWith')} />
              </Field>
            </>
          )}
        </div>
      )}
      <button className="btn">Save marital status</button>
    </form>
  );
}

function FamilyForm({
  initial,
  siblings,
  assets,
  onSave,
  onAddSibling,
  onRemoveSibling,
  onAddAsset,
  onRemoveAsset,
}: {
  initial: Draft;
  siblings: Sibling[];
  assets: Asset[];
  onSave: (b: Draft) => void;
  onAddSibling: (b: Draft) => void;
  onRemoveSibling: (id: string) => void;
  onAddAsset: (b: Draft) => void;
  onRemoveAsset: (id: string) => void;
}) {
  const father = (initial?.father ?? {}) as Draft;
  const mother = (initial?.mother ?? {}) as Draft;
  const [values, setValues] = useState<Draft>({});
  const [sibling, setSibling] = useState<Draft>({ name: '' });
  const [asset, setAsset] = useState<Draft>({ type: 'independent_house' });

  useEffect(() => {
    setValues({
      fatherName: father.name ?? '',
      fatherProfession: father.profession ?? '',
      motherName: mother.name ?? '',
      motherProfession: mother.profession ?? '',
      familyType: initial?.familyType ?? 'nuclear',
      familyStatus: initial?.familyStatus ?? '',
      brothers: initial?.brothers ?? 0,
      sisters: initial?.sisters ?? 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initial)]);

  const set = (k: string) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            father: { name: values.fatherName, profession: values.fatherProfession || undefined },
            mother: { name: values.motherName, profession: values.motherProfession || undefined },
            familyType: values.familyType,
            familyStatus: values.familyStatus,
            brothers: Number(values.brothers) || 0,
            sisters: Number(values.sisters) || 0,
          });
        }}
        className="space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Father's name">
            <input className="input mt-1" value={String(values.fatherName ?? '')} onChange={set('fatherName')} required />
          </Field>
          <Field label="Father's profession">
            <input className="input mt-1" value={String(values.fatherProfession ?? '')} onChange={set('fatherProfession')} />
          </Field>
          <Field label="Mother's name">
            <input className="input mt-1" value={String(values.motherName ?? '')} onChange={set('motherName')} required />
          </Field>
          <Field label="Mother's profession">
            <input className="input mt-1" value={String(values.motherProfession ?? '')} onChange={set('motherProfession')} />
          </Field>
          <Field label="Family type">
            <select className="input mt-1" value={String(values.familyType ?? '')} onChange={set('familyType')}>
              {Object.entries(FAMILY_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Family status">
            <input className="input mt-1" value={String(values.familyStatus ?? '')} onChange={set('familyStatus')} required />
          </Field>
          <Field label="Brothers">
            <input className="input mt-1" type="number" min={0} value={String(values.brothers ?? 0)} onChange={set('brothers')} />
          </Field>
          <Field label="Sisters">
            <input className="input mt-1" type="number" min={0} value={String(values.sisters ?? 0)} onChange={set('sisters')} />
          </Field>
        </div>
        <button className="btn">Save family details</button>
      </form>

      <div className="border-t pt-4">
        <h3 className="font-medium text-gray-900">Siblings</h3>
        <div className="mt-2 divide-y">
          {siblings.map((s) => (
            <div key={s.id} className="flex items-center justify-between py-2 text-sm">
              <span>
                {s.name}
                {s.age ? `, ${s.age}` : ''}
                {s.maritalStatus ? ` · ${MARITAL_LABEL[s.maritalStatus]}` : ''}
                {s.profession ? ` · ${s.profession}` : ''}
              </span>
              <button className="btn-outline" onClick={() => onRemoveSibling(s.id)}>
                Remove
              </button>
            </div>
          ))}
          {siblings.length === 0 && <p className="py-2 text-sm text-gray-400">None added.</p>}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            className="input flex-1"
            placeholder="Name"
            value={String(sibling.name ?? '')}
            onChange={(e) => setSibling((s) => ({ ...s, name: e.target.value }))}
          />
          <input
            className="input w-24"
            type="number"
            placeholder="Age"
            onChange={(e) => setSibling((s) => ({ ...s, age: Number(e.target.value) || undefined }))}
          />
          <input
            className="input w-40"
            placeholder="Profession"
            onChange={(e) => setSibling((s) => ({ ...s, profession: e.target.value || undefined }))}
          />
          <button
            className="btn"
            disabled={!String(sibling.name ?? '').trim()}
            onClick={() => {
              onAddSibling(sibling);
              setSibling({ name: '' });
            }}
          >
            Add
          </button>
        </div>
      </div>

      <div className="border-t pt-4">
        <h3 className="font-medium text-gray-900">Family assets</h3>
        <p className="text-xs text-gray-500">
          Hidden from everyone unless you mark one visible. Nothing here is part of the biodata you
          circulate by default.
        </p>
        <div className="mt-2 divide-y">
          {assets.map((a) => (
            <div key={a.id} className="flex items-center justify-between py-2 text-sm">
              <span>
                {ASSET_TYPE_LABEL[a.type] ?? a.type}
                {a.location ? ` · ${a.location}` : ''}
                {a.visible ? ' · shown on biodata' : ' · private'}
              </span>
              <button className="btn-outline" onClick={() => onRemoveAsset(a.id)}>
                Remove
              </button>
            </div>
          ))}
          {assets.length === 0 && <p className="py-2 text-sm text-gray-400">None recorded.</p>}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <select
            className="input w-48"
            value={String(asset.type ?? '')}
            onChange={(e) => setAsset((a) => ({ ...a, type: e.target.value }))}
          >
            {Object.entries(ASSET_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            className="input flex-1"
            placeholder="Location"
            onChange={(e) => setAsset((a) => ({ ...a, location: e.target.value || undefined }))}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              onChange={(e) => setAsset((a) => ({ ...a, visible: e.target.checked }))}
            />
            <span>Show on biodata</span>
          </label>
          <button
            className="btn"
            onClick={() => {
              onAddAsset(asset);
              setAsset({ type: 'independent_house' });
            }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function EducationForm({ initial, onSave }: { initial: Draft; onSave: (b: Draft) => void }) {
  const employment = (initial?.employment ?? {}) as Draft;
  const business = (initial?.business ?? {}) as Draft;
  const [status, setStatus] = useState<OccupationStatus>(
    (initial?.occupationStatus as OccupationStatus) ?? 'employed',
  );
  const [values, setValues] = useState<Draft>({});

  useEffect(() => {
    setStatus((initial?.occupationStatus as OccupationStatus) ?? 'employed');
    setValues({
      highestQualification: initial?.highestQualification ?? '',
      course: initial?.course ?? '',
      institution: initial?.institution ?? '',
      collegePlace: initial?.collegePlace ?? '',
      company: employment.company ?? '',
      designation: employment.designation ?? '',
      workLocation: employment.workLocation ?? '',
      salary: employment.salary ?? '',
      businessName: business.businessName ?? '',
      businessIncome: business.businessIncome ?? '',
      businessLocation: business.businessLocation ?? '',
      incomeVisible: initial?.incomeVisible ?? false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initial)]);

  const set = (k: string) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const body: Draft = {
          highestQualification: values.highestQualification,
          course: values.course,
          institution: values.institution || undefined,
          collegePlace: values.collegePlace || undefined,
          occupationStatus: status,
          incomeVisible: Boolean(values.incomeVisible),
        };
        if (status === 'employed') {
          body.employment = {
            company: values.company,
            designation: values.designation,
            workLocation: values.workLocation || undefined,
            salary: values.salary || undefined,
          };
        }
        if (status === 'self_employed') {
          body.business = {
            businessName: values.businessName,
            businessIncome: values.businessIncome || undefined,
            businessLocation: values.businessLocation || undefined,
          };
        }
        onSave(body);
      }}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Highest qualification">
          <input className="input mt-1" value={String(values.highestQualification ?? '')} onChange={set('highestQualification')} required />
        </Field>
        <Field label="Course">
          <input className="input mt-1" value={String(values.course ?? '')} onChange={set('course')} required />
        </Field>
        <Field label="Institution">
          <input className="input mt-1" value={String(values.institution ?? '')} onChange={set('institution')} />
        </Field>
        <Field label="College place">
          <input className="input mt-1" value={String(values.collegePlace ?? '')} onChange={set('collegePlace')} />
        </Field>
      </div>

      <Field label="Occupation">
        <select
          className="input mt-1"
          value={status}
          onChange={(e) => setStatus(e.target.value as OccupationStatus)}
        >
          {Object.entries(OCCUPATION_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>

      {status === 'employed' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company">
            <input className="input mt-1" value={String(values.company ?? '')} onChange={set('company')} required />
          </Field>
          <Field label="Designation">
            <input className="input mt-1" value={String(values.designation ?? '')} onChange={set('designation')} required />
          </Field>
          <Field label="Work location">
            <input className="input mt-1" value={String(values.workLocation ?? '')} onChange={set('workLocation')} />
          </Field>
          <Field label="Salary" hint="Hidden unless you tick the box below">
            <input className="input mt-1" value={String(values.salary ?? '')} onChange={set('salary')} />
          </Field>
        </div>
      )}

      {status === 'self_employed' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Business name">
            <input className="input mt-1" value={String(values.businessName ?? '')} onChange={set('businessName')} required />
          </Field>
          <Field label="Business income" hint="Hidden unless you tick the box below">
            <input className="input mt-1" value={String(values.businessIncome ?? '')} onChange={set('businessIncome')} />
          </Field>
          <Field label="Business location">
            <input className="input mt-1" value={String(values.businessLocation ?? '')} onChange={set('businessLocation')} />
          </Field>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(values.incomeVisible)}
          onChange={(e) => setValues((v) => ({ ...v, incomeVisible: e.target.checked }))}
        />
        <span>Show income on the biodata</span>
      </label>

      <button className="btn">Save education and occupation</button>
    </form>
  );
}

function PreferencesForm({ initial, onSave }: { initial: Draft; onSave: (b: Draft) => void }) {
  const prefs = (initial?.partnerPreferences ?? {}) as Draft;
  const [values, setValues] = useState<Draft>({});

  useEffect(() => {
    setValues({
      preferredAgeMin: initial?.preferredAgeMin ?? 24,
      preferredAgeMax: initial?.preferredAgeMax ?? 34,
      preferredHeightMinCm: initial?.preferredHeightMinCm ?? 150,
      preferredHeightMaxCm: initial?.preferredHeightMaxCm ?? 190,
      religion: prefs.religion ?? '',
      caste: prefs.caste ?? '',
      education: prefs.education ?? '',
      profession: prefs.profession ?? '',
      locations: prefs.locations ?? '',
      other: prefs.other ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initial)]);

  const set = (k: string) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          preferredAgeMin: Number(values.preferredAgeMin),
          preferredAgeMax: Number(values.preferredAgeMax),
          preferredHeightMinCm: Number(values.preferredHeightMinCm),
          preferredHeightMaxCm: Number(values.preferredHeightMaxCm),
          preferences: {
            religion: values.religion || undefined,
            caste: values.caste || undefined,
            education: values.education || undefined,
            profession: values.profession || undefined,
            locations: values.locations || undefined,
            other: values.other || undefined,
          },
        });
      }}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Age from">
          <input className="input mt-1" type="number" min={18} max={100} value={String(values.preferredAgeMin ?? '')} onChange={set('preferredAgeMin')} required />
        </Field>
        <Field label="Age to">
          <input className="input mt-1" type="number" min={18} max={100} value={String(values.preferredAgeMax ?? '')} onChange={set('preferredAgeMax')} required />
        </Field>
        <Field label="Height from (cm)">
          <input className="input mt-1" type="number" min={120} max={230} value={String(values.preferredHeightMinCm ?? '')} onChange={set('preferredHeightMinCm')} required />
        </Field>
        <Field label="Height to (cm)">
          <input className="input mt-1" type="number" min={120} max={230} value={String(values.preferredHeightMaxCm ?? '')} onChange={set('preferredHeightMaxCm')} required />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Religion">
          <input className="input mt-1" value={String(values.religion ?? '')} onChange={set('religion')} />
        </Field>
        <Field label="Caste">
          <input className="input mt-1" value={String(values.caste ?? '')} onChange={set('caste')} />
        </Field>
        <Field label="Education">
          <input className="input mt-1" value={String(values.education ?? '')} onChange={set('education')} />
        </Field>
        <Field label="Profession">
          <input className="input mt-1" value={String(values.profession ?? '')} onChange={set('profession')} />
        </Field>
        <Field label="Preferred locations">
          <input className="input mt-1" value={String(values.locations ?? '')} onChange={set('locations')} />
        </Field>
      </div>
      <Field label="Anything else">
        <textarea className="input mt-1" rows={2} value={String(values.other ?? '')} onChange={set('other')} />
      </Field>
      <button className="btn">Save preferences</button>
    </form>
  );
}

/**
 * Aadhaar verification.
 *
 * Worth telling people plainly what happens to the number, because the honest
 * answer is unusually reassuring: it is checked, turned into a fingerprint, and
 * thrown away.
 */
function AadhaarPanel({ profileId }: { profileId: string }) {
  const qc = useQueryClient();
  const [aadhaar, setAadhaar] = useState('');
  const [code, setCode] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [devCode, setDevCode] = useState('');
  const [error, setError] = useState('');

  const { data } = useQuery({
    queryKey: ['aadhaar', profileId],
    queryFn: async () => (await api.get(`/profiles/${profileId}/identity/aadhaar`)).data,
    retry: false,
    enabled: Boolean(profileId),
  });

  if (data?.verifiedAt) {
    return (
      <div className="space-y-1">
        <p className="flex flex-wrap items-center gap-2 text-sm text-gray-800">
          <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">
            Verified
          </span>
          Aadhaar ending <strong>{data.last4}</strong>
          <span className="text-xs text-gray-500">on {formatDate(data.verifiedAt)}</span>
        </p>
        <p className="text-xs text-gray-500">
          The number itself was never stored. Only these four digits and a one-way fingerprint are
          kept.
        </p>
      </div>
    );
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const { data: res } = await api.post(`/profiles/${profileId}/identity/aadhaar/send-otp`, {
        aadhaarNumber: aadhaar,
      });
      setSessionId(res.sessionId);
      setDevCode(res.devCode ?? '');
      setAadhaar('');
    } catch (err) {
      setError(apiMessage(err, 'That number could not be verified.'));
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/profiles/${profileId}/identity/aadhaar/verify-otp`, { sessionId, code });
      qc.invalidateQueries({ queryKey: ['aadhaar', profileId] });
      qc.invalidateQueries({ queryKey: ['biodata', profileId] });
    } catch (err) {
      setError(apiMessage(err, 'That code was not accepted.'));
    }
  }

  return (
    <div className="space-y-3">
      {/*
        The half-finished state used to look identical to never having started:
        somebody whose code expired saw a blank form and no idea whether their
        earlier attempt had counted for anything.
      */}
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span
          className={`rounded-full px-2 py-1 text-xs font-medium ${
            data?.submittedAt ? 'bg-amber-50 text-amber-800' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {data?.submittedAt ? 'Started, not verified' : 'Not verified'}
        </span>
        {data?.last4 && (
          <span className="text-gray-700">
            Aadhaar ending <strong>{data.last4}</strong> is on file
          </span>
        )}
      </p>

      <p className="text-sm text-gray-600">
        One document, one profile — this is what keeps duplicates off the platform. The number is
        checked, turned into a fingerprint and discarded; only the last four digits are kept.
      </p>
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}

      {!sessionId ? (
        <form onSubmit={send} className="flex flex-wrap items-end gap-2">
          <Field label="Aadhaar number">
            <input
              className="input mt-1"
              inputMode="numeric"
              placeholder="2345 6789 0124"
              value={aadhaar}
              onChange={(e) => setAadhaar(e.target.value)}
              required
            />
          </Field>
          <button className="btn">Send OTP</button>
        </form>
      ) : (
        <form onSubmit={verify} className="flex flex-wrap items-end gap-2">
          <Field
            label="Six-digit code"
            hint={devCode ? `Development mode — the code is ${devCode}` : 'Sent to the registered mobile'}
          >
            <input
              className="input mt-1 w-40"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </Field>
          <button className="btn">Verify</button>
          <button type="button" className="btn-outline" onClick={() => setSessionId('')}>
            Start again
          </button>
        </form>
      )}
    </div>
  );
}
