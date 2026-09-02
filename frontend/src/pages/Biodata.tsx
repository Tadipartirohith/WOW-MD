import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import {
  ASSET_TYPE_LABEL,
  FAMILY_TYPE_LABEL,
  MARITAL_LABEL,
  SELF_MARITAL_STATUSES,
  MaritalStatus,
  OCCUPATION_LABEL,
  OccupationStatus,
  Permission,
  COMPLEXION_LABEL,
  FAMILY_STATUS_LABEL,
  can,
} from '../lib/permissions';
import ProfileSelector from '../components/ProfileSelector';
import ProfilePhotos from '../components/ProfilePhotos';
import PhotoUploader from '../components/PhotoUploader';
import ChoiceField from '../components/ChoiceField';
import {
  CASTES_BY_RELIGION,
  CITIES,
  COUNTRIES,
  MOTHER_TONGUES,
  NAKSHATRAS,
  PADAMS,
  PROFESSIONS,
  QUALIFICATIONS,
  RASHIS,
  RELIGIONS,
  STATES,
} from '../lib/reference';
import SavedBiodata from '../components/SavedBiodata';
import ProfileCard from '../components/ProfileCard';
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
      await qc.invalidateQueries({ queryKey: ['biodata', targetId] });

      // Straight on to the next section. Leaving the page where it was meant
      // scrolling back up to find the next thing, which is where people
      // stopped.
      const next = nextSection(section);
      if (next) {
        setOpen(next);
        setNotice(`Saved. Next: ${SECTION_LABEL[next] ?? next}.`);
        /*
         * To the next section, not to the top of the page.
         *
         * This scrolled to the top, on the reasoning that the next section
         * would otherwise open below the fold on a phone. It does solve that
         * and it is the reported complaint: somebody who has just finished
         * section three is put back at the beginning and has to scroll down
         * past everything they have already done. Bringing the section itself
         * into view solves the fold problem without the journey back.
         */
        requestAnimationFrame(() => {
          document
            .getElementById(`section-${next}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      } else {
        setNotice('Saved. That is the last section.');
      }
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
        <h1 className="page-title">Client biodata</h1>
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
          <h1 className="page-title">Biodata</h1>
          <p className="page-subtitle">
            Saved section by section. You can stop and come back.
          </p>
        </div>
        {/*
          "Client" is an agency's word for an agency's business. A father
          filling in his daughter's biodata is not looking at a client, and
          being told he is reads as the platform having mistaken him for one.
        */}
        {isSteward && (
          <ProfileSelector
            value={profileId}
            onChange={setProfileId}
            label={isAgent ? 'Client' : 'Browsing as'}
          />
        )}
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
          <div className="h-2 w-full overflow-hidden rounded-sm bg-gray-100">
            <div
              className="h-full rounded-sm bg-brand transition-all"
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

      {error && <p className="alert-critical">{error}</p>}
      {notice && <p className="alert-positive">{notice}</p>}

      {/*
        The thing they made, before the forms that made it. A read-back list is
        still a list; what somebody wants after filling this in is to see a
        photograph and a name.
      */}
      {targetId && Object.keys(details).length > 0 && (
        <ProfileCard
          profileId={targetId}
          profile={me ?? null}
          details={details}
          complete={completion?.complete ?? false}
          percent={completion?.percent ?? 0}
          onEdit={() => setOpen('personal')}
          onPhotos={() => setOpen('photos')}
          onView={() => setOpen('saved')}
        />
      )}

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
        <PreferencesForm
          initial={details}
          onSave={(b) => save('preferences', b)}
        />
      </Accordion>

      <Accordion title="Identity verification" name="identity" open={open} setOpen={setOpen}>
        <AadhaarPanel profileId={targetId} />
      </Accordion>
    </div>
  );
}

/**
 * The order the form is filled in.
 *
 * Saving a section moves to the next one rather than leaving somebody scrolling
 * back up to find where they were — which is the reported complaint, and the
 * reason people stopped halfway. Photographs come first because the details
 * cannot be saved without three of them.
 */
/** What each section is called, for the "next" line after a save. */
const SECTION_LABEL: Record<string, string> = {
  photos: 'Photographs',
  personal: 'Personal details',
  religion: 'Religion and community',
  horoscope: 'Horoscope',
  marital: 'Marital status',
  family: 'Family',
  education: 'Education and occupation',
  preferences: 'Partner preferences',
  identity: 'Identity verification',
};

const SECTION_ORDER = [
  'photos',
  'personal',
  'religion',
  'horoscope',
  'marital',
  'family',
  'education',
  'preferences',
  'identity',
] as const;

function nextSection(current: string): string | null {
  const i = SECTION_ORDER.indexOf(current as (typeof SECTION_ORDER)[number]);
  if (i === -1 || i === SECTION_ORDER.length - 1) return null;
  return SECTION_ORDER[i + 1];
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
  const step = SECTION_ORDER.indexOf(name as (typeof SECTION_ORDER)[number]);
  return (
    // Addressable so that saving one section can bring the next into view
    // rather than throwing the page back to the top.
    <div className="card" id={`section-${name}`}>
      <button
        className="flex w-full items-center justify-between text-left"
        onClick={() => setOpen(isOpen ? '' : name)}
      >
        <span className="font-semibold text-gray-900">
          {/* Which of how many, so the form has a visible end. */}
          {step >= 0 && (
            <span className="mr-2 text-xs font-normal text-gray-400">
              {step + 1} of {SECTION_ORDER.length}
            </span>
          )}
          {title}
        </span>
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
  /** For controls that hand back a value rather than an event. */
  const put = (key: string) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  return { draft, setDraft, set, put };
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
          <select
            className="input mt-1"
            value={String(draft.complexion ?? '')}
            onChange={set('complexion')}
            required
          >
            <option value="">Select…</option>
            {Object.entries(COMPLEXION_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
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
        <Field label="Alternate mobile" hint="Optional: often the family's number">
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
  const { draft, put } = useDraft(initial, [
    'religion',
    'caste',
    'subCaste',
    'motherTongue',
  ]);

  const religion = String(draft.religion ?? '');
  /*
   * Castes follow the religion, not one list for everybody.
   *
   * Offering a Hindu caste list to a Christian family is not a neutral
   * mistake. Religions with no caste structure get an empty list, and the
   * field then offers only the free-text box.
   */
  const casteOptions = CASTES_BY_RELIGION[religion] ?? [];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        // Denomination is deliberately not sent: the field is gone, and the
        // server treats it as optional, so an old value simply stops being
        // rewritten. Nothing is deleted from rows that already have one.
        onSave(draft);
      }}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <ChoiceField
          label="Religion"
          value={religion}
          onChange={put('religion')}
          options={RELIGIONS}
          required
        />
        <ChoiceField
          label="Caste"
          value={String(draft.caste ?? '')}
          onChange={put('caste')}
          options={casteOptions}
          hint={religion ? undefined : 'Pick a religion first, or type the caste.'}
          required
        />
        {/*
          Sub-caste and gothram have no finite list — there are thousands, and
          they vary by district. The control is a dropdown of nothing plus the
          free-text escape, which is the honest shape for them.
        */}
        <ChoiceField
          label="Sub-caste"
          value={String(draft.subCaste ?? '')}
          onChange={put('subCaste')}
          options={[]}
          required
        />
        <ChoiceField
          label="Mother tongue"
          value={String(draft.motherTongue ?? '')}
          onChange={put('motherTongue')}
          options={MOTHER_TONGUES}
          required
        />
      </div>
      <button className="btn">Save religion details</button>
    </form>
  );
}

/**
 * Rupees, grouped the Indian way.
 *
 * 75,00,000 rather than 7,500,000 — the grouping is not decoration, it is how
 * the number is read aloud, and a lakh written in thousands has to be counted
 * on fingers before it means anything.
 */
function rupees(value: number | string): string {
  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(amount)) return String(value);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function HoroscopeForm({ initial, onSave }: { initial: Draft; onSave: (b: Draft) => void }) {
  const chart = (initial?.horoscope ?? {}) as Draft;
  const [available, setAvailable] = useState(Boolean(initial?.horoscopeAvailable));
  const [values, setValues] = useState<Draft>({});

  useEffect(() => {
    setAvailable(Boolean(initial?.horoscopeAvailable));
    const place = (chart.birthPlace ?? {}) as Draft;
    setValues({
      rashi: chart.rashi ?? '',
      star: chart.star ?? '',
      padam: chart.padam ?? '',
      gothram: chart.gothram ?? '',
      kujaDosham: chart.kujaDosham ?? '',
      timeOfBirth: chart.timeOfBirth ?? '',
      birthCity: place.city ?? '',
      birthState: place.state ?? '',
      birthCountry: place.country ?? '',
      horoscopeDocumentUrl: initial?.horoscopeDocumentUrl ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initial)]);

  const set = (k: string) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));
  const put = (k: string) => (value: string) => setValues((v) => ({ ...v, [k]: value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        /*
         * Where and when somebody was born is true either way.
         *
         * These used to live inside the "a horoscope is available" branch, so
         * a family that does not keep one could not record a birthplace they
         * plainly know. The requirement is explicit that all three of place,
         * time and document are optional and none of them gates a save.
         */
        const place = {
          ...(values.birthCity ? { city: String(values.birthCity) } : {}),
          ...(values.birthState ? { state: String(values.birthState) } : {}),
          ...(values.birthCountry ? { country: String(values.birthCountry) } : {}),
        };
        const always = {
          ...(values.timeOfBirth ? { timeOfBirth: String(values.timeOfBirth) } : {}),
          ...(Object.keys(place).length ? { birthPlace: place } : {}),
          ...(values.horoscopeDocumentUrl
            ? { horoscopeDocumentUrl: String(values.horoscopeDocumentUrl) }
            : {}),
        };
        const chartOnly = ['rashi', 'star', 'padam', 'gothram', 'kujaDosham'];
        onSave(
          available
            ? {
                horoscopeAvailable: true,
                ...Object.fromEntries(
                  Object.entries(values).filter(([k, v]) => chartOnly.includes(k) && v !== ''),
                ),
                ...always,
              }
            : { horoscopeAvailable: false, ...always },
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
        Answering &ldquo;no&rdquo; completes this section, plenty of families do not use one.
      </p>

      {available && (
        <div className="grid gap-3 sm:grid-cols-3">
          <ChoiceField
            label="Rashi"
            value={String(values.rashi ?? '')}
            onChange={put('rashi')}
            options={RASHIS}
            allowOther={false}
            required
          />
          <ChoiceField
            label="Star / Nakshatra"
            value={String(values.star ?? '')}
            onChange={put('star')}
            options={NAKSHATRAS}
            allowOther={false}
          />
          <ChoiceField
            label="Padam"
            value={String(values.padam ?? '')}
            onChange={put('padam')}
            options={PADAMS}
            allowOther={false}
          />
          {/* Gothrams run to thousands; the list is empty and the box is the point. */}
          <ChoiceField
            label="Gothram"
            value={String(values.gothram ?? '')}
            onChange={put('gothram')}
            options={[]}
          />
          <Field label="Kuja Dosham">
            <select className="input mt-1" value={String(values.kujaDosham ?? '')} onChange={set('kujaDosham')}>
              <option value="">Not stated</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
              <option value="unknown">Unknown</option>
            </select>
          </Field>
        </div>
      )}

      {/*
        Outside the checkbox on purpose.

        Where and when somebody was born is true whether or not the family
        keeps a chart, and the requirement is explicit that none of these three
        may block a save.
      */}
      <div className="grid gap-3 border-t pt-3 sm:grid-cols-4">
        <ChoiceField
          label="Birth city"
          value={String(values.birthCity ?? '')}
          onChange={put('birthCity')}
          options={CITIES}
        />
        <ChoiceField
          label="Birth state"
          value={String(values.birthState ?? '')}
          onChange={put('birthState')}
          options={STATES}
        />
        <ChoiceField
          label="Birth country"
          value={String(values.birthCountry ?? '')}
          onChange={put('birthCountry')}
          options={COUNTRIES}
        />
        <Field label="Time of birth" hint="Optional">
          <input className="input mt-1" type="time" value={String(values.timeOfBirth ?? '')} onChange={set('timeOfBirth')} />
        </Field>
      </div>

      {/*
        The chart itself, back where it belongs.

        This lived on Partner Preferences — the screen for what you want of
        somebody else — so the section describing your own horoscope had no way
        to attach one. Optional: ticking "a horoscope is available" says a
        chart exists, not that it has been scanned.
      */}
      <div className="space-y-3 rounded-sm border border-gray-200 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-gray-800">Horoscope document</p>
            <p className="text-xs text-gray-500">
              Optional. Shared only with families you have accepted an interest from.
            </p>
          </div>
          <PhotoUploader
            kind="attachment"
            label={values.horoscopeDocumentUrl ? 'Replace chart' : 'Attach chart'}
            onUploaded={(url: string) => setValues((v) => ({ ...v, horoscopeDocumentUrl: url }))}
          />
        </div>
        {values.horoscopeDocumentUrl ? (
          <div className="flex flex-wrap items-start gap-3 rounded-sm bg-surface-sunken p-3">
            <a
              href={String(values.horoscopeDocumentUrl)}
              target="_blank"
              rel="noreferrer"
              className="shrink-0"
              title="Open the full chart"
            >
              <img
                src={String(values.horoscopeDocumentUrl)}
                alt="The horoscope chart you attached"
                className="h-28 w-28 rounded-sm border border-gray-200 bg-surface object-cover"
              />
            </a>
            <div className="min-w-[12rem] flex-1 space-y-1">
              <p className="text-sm font-medium text-gray-800">Chart attached</p>
              <button
                type="button"
                className="btn-ghost btn-sm -ml-2 text-critical-fg"
                onClick={() => setValues((v) => ({ ...v, horoscopeDocumentUrl: '' }))}
              >
                Remove chart
              </button>
            </div>
          </div>
        ) : null}
      </div>

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
      reason: history.reason ?? '',
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
          if (values.reason) body.reason = values.reason;
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
          {SELF_MARITAL_STATUSES.map((value) => (
            <option key={value} value={value}>
              {MARITAL_LABEL[value]}
            </option>
          ))}
        </select>
      </Field>

      {/*
        Asked only where it applies, and never required. Somebody who would
        rather not explain must still be able to finish the section — a
        mandatory box here gets answered with a full stop, which is worse than
        silence because it looks like an answer.
      */}
      {(status === 'divorced' || status === 'separated') && (
        <Field
          label="What happened, if you would like to say"
          hint="Optional. Shown only to people who can already see your marital history."
        >
          <textarea
            className="input mt-1"
            rows={3}
            maxLength={2000}
            value={String(values.reason ?? '')}
            onChange={set('reason')}
          />
        </Field>
      )}

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

/**
 * Where the family is from.
 *
 * Asked here rather than in the personal section: it is a fact about a family,
 * which is what the other side is asking when they ask, and it used to sit
 * beside a "place of birth" that people answered as though it were the same
 * question.
 */
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
      // Accepted by the API from the beginning and never asked for here, so
      // every profile on the platform carries an empty one.
      fatherLifeStatus: father.lifeStatus ?? '',
      motherName: mother.name ?? '',
      motherProfession: mother.profession ?? '',
      motherLifeStatus: mother.lifeStatus ?? '',
      familyType: initial?.familyType ?? 'nuclear',
      familyStatus: initial?.familyStatus ?? '',
      nativePlace: initial?.nativePlace ?? '',
      nativeState: initial?.nativeState ?? '',
      isNri: Boolean(initial?.isNri),
      nriCity: initial?.nriCity ?? '',
      nriCountry: initial?.nriCountry ?? '',
      brothers: initial?.brothers ?? 0,
      sisters: initial?.sisters ?? 0,
      // `numeric` comes back from the API as a string, so it is kept as one
      // here and only converted on the way out.
      familyNetWorth: initial?.familyNetWorth ?? '',
      familyNetWorthVisible: Boolean(initial?.familyNetWorthVisible),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initial)]);

  const set = (k: string) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));
  const put = (k: string) => (value: string) => setValues((v) => ({ ...v, [k]: value }));

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            father: {
              name: values.fatherName,
              profession: values.fatherProfession || undefined,
              lifeStatus: values.fatherLifeStatus || undefined,
            },
            mother: {
              name: values.motherName,
              profession: values.motherProfession || undefined,
              lifeStatus: values.motherLifeStatus || undefined,
            },
            familyType: values.familyType,
            familyStatus: values.familyStatus,
            nativePlace: values.nativePlace || undefined,
            nativeState: values.nativeState || undefined,
            isNri: Boolean(values.isNri),
            // Only sent when the answer is yes. A city and country left behind
            // by somebody who changed their mind would otherwise stay on the
            // record, invisible, and reappear if the answer ever flipped back.
            nriCity: values.isNri ? values.nriCity || undefined : undefined,
            nriCountry: values.isNri ? values.nriCountry || undefined : undefined,
            brothers: Number(values.brothers) || 0,
            sisters: Number(values.sisters) || 0,
            // Omitted rather than sent as zero when it is blank. Zero is a
            // claim about the family's finances; "not answered" is not.
            familyNetWorth:
              String(values.familyNetWorth ?? '').trim() === ''
                ? undefined
                : Number(values.familyNetWorth),
            familyNetWorthVisible: Boolean(values.familyNetWorthVisible),
          });
        }}
        className="space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Father's name">
            <input className="input mt-1" value={String(values.fatherName ?? '')} onChange={set('fatherName')} required />
          </Field>
          <Field label="Father's profession">
            <ChoiceField
              label=""
              value={String(values.fatherProfession ?? '')}
              onChange={put('fatherProfession')}
              options={PROFESSIONS}
            />
          </Field>
          {/*
            Living status sits directly under each parent rather than as a pair
            of fields further down, so it reads as a fact about that person and
            not as a separate question about the family.
          */}
          <Field label="Father's living status">
            <select
              className="input mt-1"
              value={String(values.fatherLifeStatus ?? '')}
              onChange={set('fatherLifeStatus')}
            >
              <option value="">Not said</option>
              <option value="alive">Alive</option>
              <option value="deceased">Deceased</option>
            </select>
          </Field>
          <Field label="Mother's name">
            <input className="input mt-1" value={String(values.motherName ?? '')} onChange={set('motherName')} required />
          </Field>
          <Field label="Mother's profession">
            <ChoiceField
              label=""
              value={String(values.motherProfession ?? '')}
              onChange={put('motherProfession')}
              options={PROFESSIONS}
            />
          </Field>
          <Field label="Mother's living status">
            <select
              className="input mt-1"
              value={String(values.motherLifeStatus ?? '')}
              onChange={set('motherLifeStatus')}
            >
              <option value="">Not said</option>
              <option value="alive">Alive</option>
              <option value="deceased">Deceased</option>
            </select>
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
            <select
              className="input mt-1"
              value={String(values.familyStatus ?? '')}
              onChange={set('familyStatus')}
              required
            >
              <option value="">Select…</option>
              {Object.entries(FAMILY_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Native place" hint="Where the family is from">
            <ChoiceField
              label=""
              value={String(values.nativePlace ?? '')}
              onChange={put('nativePlace')}
              options={CITIES}
            />
          </Field>
          {/*
            The state, beside the town rather than instead of it. A town on its
            own is ambiguous across India — there are Rampurs in six states —
            and the question being asked has two halves.
          */}
          <Field label="Native state">
            <input
              className="input mt-1"
              value={String(values.nativeState ?? '')}
              onChange={set('nativeState')}
              placeholder="Telangana"
            />
          </Field>
          <Field label="Brothers">
            <input className="input mt-1" type="number" min={0} value={String(values.brothers ?? 0)} onChange={set('brothers')} />
          </Field>
          <Field label="Sisters">
            <input className="input mt-1" type="number" min={0} value={String(values.sisters ?? 0)} onChange={set('sisters')} />
          </Field>
          {/*
            Asked as yes/no with the detail hanging off the yes, rather than as
            a country box that is blank for most people. A blank country cannot
            be told apart from "lives in India" or "did not answer", and
            families treat those as different answers.
          */}
          <Field label="Settled abroad">
            <select
              className="input mt-1"
              value={values.isNri ? 'yes' : 'no'}
              onChange={(e) =>
                setValues((v) => ({ ...v, isNri: e.target.value === 'yes' }))
              }
            >
              <option value="no">No</option>
              <option value="yes">Yes, an NRI</option>
            </select>
          </Field>
          {values.isNri ? (
            <>
              <Field label="City abroad">
                <input
                  className="input mt-1"
                  value={String(values.nriCity ?? '')}
                  onChange={set('nriCity')}
                  placeholder="Dubai"
                />
              </Field>
              <Field label="Country">
                <input
                  className="input mt-1"
                  value={String(values.nriCountry ?? '')}
                  onChange={set('nriCountry')}
                  placeholder="United Arab Emirates"
                />
              </Field>
            </>
          ) : null}
          {/*
            One figure for the family, alongside the itemised assets rather
            than instead of them. Optional, and private unless the family says
            otherwise — the same rule money follows everywhere else here.
          */}
          <Field label="Family net worth" hint="Rupees. Optional, and hidden unless you say otherwise">
            <input
              className="input mt-1"
              type="number"
              min={0}
              value={String(values.familyNetWorth ?? '')}
              onChange={set('familyNetWorth')}
            />
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(values.familyNetWorthVisible)}
              onChange={(e) =>
                setValues((v) => ({ ...v, familyNetWorthVisible: e.target.checked }))
              }
            />
            <span>Show net worth on the biodata</span>
          </label>
        </div>
        <button className="btn">Save family details</button>
      </form>

      <div className="border-t pt-4">
        <h3 className="section-title">Siblings</h3>
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
        {/*
          A labelled grid, and every input controlled.

          Only "Name" had a `value`, so after adding a sibling the state reset
          and the two uncontrolled boxes kept what had been typed in them — the
          form showed an empty name next to a stale age and profession, which is
          exactly the "not looking good, should be in good order" report. React
          never wrote to those inputs at all; they were the browser's.
        */}
        <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Name">
            <input
              className="input mt-1"
              value={String(sibling.name ?? '')}
              onChange={(e) => setSibling((s) => ({ ...s, name: e.target.value }))}
            />
          </Field>
          <Field label="Age">
            <input
              className="input mt-1"
              type="number"
              min={0}
              max={120}
              value={String(sibling.age ?? '')}
              onChange={(e) =>
                setSibling((s) => ({ ...s, age: Number(e.target.value) || undefined }))
              }
            />
          </Field>
          <Field label="Marital status">
            <select
              className="input mt-1"
              value={String(sibling.maritalStatus ?? '')}
              onChange={(e) =>
                setSibling((s) => ({ ...s, maritalStatus: e.target.value || undefined }))
              }
            >
              <option value="">Not stated</option>
              {Object.entries(MARITAL_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <ChoiceField
            label="Profession"
            value={String(sibling.profession ?? '')}
            onChange={(v) => setSibling((s) => ({ ...s, profession: v || undefined }))}
            options={PROFESSIONS}
          />
        </div>
        <button
          className="btn mt-2"
          disabled={!String(sibling.name ?? '').trim()}
          onClick={() => {
            onAddSibling(sibling);
            setSibling({ name: '' });
          }}
        >
          Add sibling
        </button>
      </div>

      <div className="border-t pt-4">
        <h3 className="section-title">Family assets</h3>
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
                {a.area ? ` · ${a.area}` : ''}
                {a.estimatedValue ? ` · ${rupees(a.estimatedValue)}` : ''}
                {a.visible ? ' · shown on biodata' : ' · private'}
              </span>
              <button className="btn-outline" onClick={() => onRemoveAsset(a.id)}>
                Remove
              </button>
            </div>
          ))}
          {assets.length === 0 && <p className="py-2 text-sm text-gray-400">None recorded.</p>}
        </div>
        {/*
          Estimated value has a box now.

          The field existed on the API and had done from the start, and this
          form never offered it — so a family that entered one through some
          other route saw it saved and never displayed, which is precisely what
          was reported. Same fix on both halves: a labelled, controlled input
          here, and the figure printed in the list above.
        */}
        <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Type">
            <select
              className="input mt-1"
              value={String(asset.type ?? '')}
              onChange={(e) => setAsset((a) => ({ ...a, type: e.target.value }))}
            >
              {Object.entries(ASSET_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Location">
            <input
              className="input mt-1"
              value={String(asset.location ?? '')}
              onChange={(e) => setAsset((a) => ({ ...a, location: e.target.value || undefined }))}
            />
          </Field>
          <Field label="Area" hint="Acres, square yards, whatever it is measured in">
            <input
              className="input mt-1"
              value={String(asset.area ?? '')}
              onChange={(e) => setAsset((a) => ({ ...a, area: e.target.value || undefined }))}
            />
          </Field>
          <Field label="Estimated value" hint="Rupees">
            <input
              className="input mt-1"
              type="number"
              min={0}
              value={String(asset.estimatedValue ?? '')}
              onChange={(e) =>
                setAsset((a) => ({ ...a, estimatedValue: Number(e.target.value) || undefined }))
              }
            />
          </Field>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(asset.visible)}
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
            Add asset
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
  const put = (k: string) => (value: string) => setValues((v) => ({ ...v, [k]: value }));

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
          <ChoiceField
            label=""
            value={String(values.highestQualification ?? '')}
            onChange={put('highestQualification')}
            options={QUALIFICATIONS}
            required
          />
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

/**
 * Partner preferences, with your own chart on the same screen.
 *
 * What a family expects of a horoscope and what their own says are asked in
 * the same breath in person, and were two separate sections here — so the
 * preferences screen offered an "attach horoscope" button and nothing to say
 * what the chart contained. The structured fields sit alongside the
 * expectations now.
 *
 * They still save to the horoscope section, not into preferences: rashi and
 * gothram are facts about this person, and duplicating them under partner
 * preferences would be two copies of one truth waiting to disagree.
 */
function PreferencesForm({
  initial,
  onSave,
}: {
  initial: Draft;
  onSave: (b: Draft) => void;
}) {
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
      horoscopeExpectation: prefs.horoscopeExpectation ?? '',
      kujaDosham: prefs.kujaDosham ?? '',
      preferredStars: prefs.preferredStars ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initial)]);

  const set = (k: string) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));
  const put = (k: string) => (value: string) => setValues((v) => ({ ...v, [k]: value }));

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
          horoscopeExpectation: values.horoscopeExpectation || undefined,
          kujaDosham: values.kujaDosham || undefined,
          preferredStars: values.preferredStars || undefined,
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
        {/*
          The same vocabulary the profile uses.

          A preference typed as "s/w engineer" against a profile that says
          "IT / Software Professional" is a preference that can never match.
          Blank stays a real answer throughout — it means no preference, not an
          unanswered question.
        */}
        <ChoiceField
          label="Religion"
          value={String(values.religion ?? '')}
          onChange={put('religion')}
          options={RELIGIONS}
          placeholder="No preference"
        />
        <ChoiceField
          label="Caste"
          value={String(values.caste ?? '')}
          onChange={put('caste')}
          options={CASTES_BY_RELIGION[String(values.religion ?? '')] ?? []}
          placeholder="No preference"
        />
        <ChoiceField
          label="Education"
          value={String(values.education ?? '')}
          onChange={put('education')}
          options={QUALIFICATIONS}
          placeholder="No preference"
        />
        <ChoiceField
          label="Profession"
          value={String(values.profession ?? '')}
          onChange={put('profession')}
          options={PROFESSIONS}
          placeholder="No preference"
        />
        <ChoiceField
          label="Preferred location"
          value={String(values.locations ?? '')}
          onChange={put('locations')}
          options={CITIES}
          placeholder="No preference"
        />
      </div>

      {/*
        Horoscope expectations belong here rather than on the chart itself: the
        chart is a fact about you, this is what you are asking of somebody
        else. "No preference" is a real answer and is offered as one — a family
        that does not use horoscopes is not asking anybody to abandon theirs.
      */}
      <div className="grid gap-3 border-t pt-3 sm:grid-cols-3">
        <Field label="Horoscope">
          <select
            className="input mt-1"
            value={String(values.horoscopeExpectation ?? '')}
            onChange={set('horoscopeExpectation')}
          >
            <option value="">No preference</option>
            <option value="required">Required</option>
            <option value="preferred">Preferred</option>
            <option value="not_required">Not required</option>
          </select>
        </Field>
        <Field label="Kuja dosham">
          <select
            className="input mt-1"
            value={String(values.kujaDosham ?? '')}
            onChange={set('kujaDosham')}
          >
            <option value="">No preference</option>
            <option value="must_match">Must match</option>
            <option value="no_objection">No objection</option>
          </select>
        </Field>
        <Field label="Stars or rashis you are looking for">
          <input
            className="input mt-1"
            placeholder="Ashwini, Bharani…"
            value={String(values.preferredStars ?? '')}
            onChange={set('preferredStars')}
          />
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
        One document, one profile. This is what keeps duplicates off the platform. The number is
        checked, turned into a fingerprint and discarded; only the last four digits are kept.
      </p>
      {error && <p className="alert-critical">{error}</p>}

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
            hint={devCode ? `Development mode, the code is ${devCode}` : 'Sent to the registered mobile'}
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
