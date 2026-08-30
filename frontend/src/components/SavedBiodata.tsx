import { ReactNode } from 'react';
import { formatDate } from '../lib/dates';

interface Sibling {
  id: string;
  name: string;
  age: number | null;
  maritalStatus: string | null;
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
 * Everything the biodata actually holds, read back.
 *
 * The sections below this are forms, and a form full of your own answers looks
 * exactly like a form you have not filled in yet — which is why people saved,
 * saw the same boxes, and concluded nothing had been stored. This is the other
 * half of the answer: one place that says, plainly, here is what we hold.
 *
 * Rendered from the server's response rather than from any local draft, so it
 * cannot show something that failed to save.
 */
/** Rupees, grouped the Indian way — lakhs and crores, not thousands. */
function rupees(value: number | string): string {
  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(amount)) return String(value);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function SavedBiodata({
  details,
  siblings,
  assets,
}: {
  details: Record<string, unknown>;
  siblings: Sibling[];
  assets: Asset[];
}) {
  const has = Object.keys(details ?? {}).some(
    (k) => details[k] !== null && details[k] !== undefined && details[k] !== '',
  );

  if (!has) {
    return (
      <p className="text-sm text-gray-400">
        Nothing saved yet. Fill in a section below and it will appear here.
      </p>
    );
  }

  const str = (key: string) => {
    const v = details[key];
    return v === null || v === undefined || v === '' ? null : String(v);
  };
  const num = (key: string) => {
    const v = details[key];
    return typeof v === 'number' ? v : null;
  };
  const bag = (key: string) => (details[key] ?? {}) as Record<string, unknown>;
  const inBag = (key: string, field: string) => {
    const v = bag(key)[field];
    return v === null || v === undefined || v === '' ? null : String(v);
  };

  const height = num('heightCm');
  const father = bag('father');
  const mother = bag('mother');

  return (
    <div className="space-y-5 text-sm">
      <Group title="Personal">
        <Row label="Name">
          {[str('firstName'), str('lastName')].filter(Boolean).join(' ') || null}
        </Row>
        <Row label="Height">{height ? `${height} cm` : null}</Row>
        <Row label="Complexion">{str('complexion')}</Row>
        <Row label="Alternate mobile">{str('alternateMobile')}</Row>
        <Row label="Address">{str('communicationAddress')}</Row>
      </Group>

      <Group title="Religion and community">
        <Row label="Religion">{str('religion')}</Row>
        <Row label="Caste">{str('caste')}</Row>
        <Row label="Sub-caste">{str('subCaste')}</Row>
        <Row label="Mother tongue">{str('motherTongue')}</Row>
        <Row label="Denomination">{str('denomination')}</Row>
      </Group>

      <Group title="Horoscope">
        {/*
          Three states, not two. "Not answered" is not "no horoscope" — that
          distinction was a real defect once and is worth showing here.
        */}
        <Row label="Has a horoscope">
          {details.horoscopeAvailable === null || details.horoscopeAvailable === undefined
            ? null
            : details.horoscopeAvailable
              ? 'Yes'
              : 'No'}
        </Row>
        {details.horoscopeAvailable ? (
          <>
            <Row label="Rashi">{inBag('horoscope', 'rashi')}</Row>
            <Row label="Star">{inBag('horoscope', 'star')}</Row>
            <Row label="Kuja dosham">{inBag('horoscope', 'kujaDosham')}</Row>
            <Row label="Time of birth">{inBag('horoscope', 'timeOfBirth')}</Row>
          </>
        ) : null}
      </Group>

      <Group title="Marital status">
        <Row label="Status">{str('maritalStatus')?.replace(/_/g, ' ')}</Row>
        <Row label="Married on">{inBag('maritalHistory', 'marriageDate')}</Row>
        <Row label="Ended">
          {inBag('maritalHistory', 'divorceDate') ?? inBag('maritalHistory', 'separationDate')}
        </Row>
        {inBag('maritalHistory', 'reason') && (
          <Row label="What happened">{inBag('maritalHistory', 'reason')}</Row>
        )}
      </Group>

      <Group title="Family">
        <Row label="Father">
          {[father.name, father.profession, father.lifeStatus].filter(Boolean).join(' · ') || null}
        </Row>
        <Row label="Mother">
          {[mother.name, mother.profession, mother.lifeStatus].filter(Boolean).join(' · ') || null}
        </Row>
        <Row label="Native place">{str('nativePlace')}</Row>
        <Row label="Family type">{str('familyType')}</Row>
        <Row label="Family status">{str('familyStatus')}</Row>
        {/*
          Only when the family chose to publish it. A net worth on file and a
          net worth on the biodata are two different decisions, and this
          component is not the place to make the second one on their behalf.
        */}
        {details?.familyNetWorthVisible && details?.familyNetWorth ? (
          <Row label="Family net worth">{rupees(details.familyNetWorth as string)}</Row>
        ) : null}
        <Row label="Brothers / sisters">
          {num('brothers') !== null || num('sisters') !== null
            ? `${num('brothers') ?? 0} / ${num('sisters') ?? 0}`
            : null}
        </Row>
        {siblings.length > 0 && (
          <Row label="Siblings">
            {siblings
              .map((sib) =>
                [
                  sib.name,
                  sib.age ? `${sib.age}` : null,
                  sib.maritalStatus?.replace(/_/g, ' '),
                  sib.profession,
                ]
                  .filter(Boolean)
                  .join(', '),
              )
              .join(' · ')}
          </Row>
        )}
      </Group>

      <Group title="Education and occupation">
        <Row label="Qualification">{str('highestQualification')}</Row>
        <Row label="Course">{str('course')}</Row>
        <Row label="Institution">{str('institution')}</Row>
        <Row label="Occupation">{str('occupationStatus')?.replace(/_/g, ' ')}</Row>
        <Row label="Employer">
          {inBag('employment', 'company') ?? inBag('business', 'businessName')}
        </Row>
        <Row label="Role">{inBag('employment', 'designation')}</Row>
        <Row label="Where">
          {inBag('employment', 'workLocation') ?? inBag('business', 'businessLocation')}
        </Row>
        {/*
          Income is shown only when the profile has chosen to publish it. It is
          the field people are most careful about, so the read-back has to be
          as careful as the sharing rule.
        */}
        {details.incomeVisible ? (
          <Row label="Income">
            {inBag('employment', 'salary') ?? inBag('business', 'businessIncome')}
          </Row>
        ) : (
          <Row label="Income">
            <span className="text-gray-400">Kept private</span>
          </Row>
        )}
      </Group>

      <Group title="Partner preferences">
        <Row label="Age">
          {num('preferredAgeMin') && num('preferredAgeMax')
            ? `${num('preferredAgeMin')} – ${num('preferredAgeMax')}`
            : null}
        </Row>
        <Row label="Height">
          {num('preferredHeightMinCm') && num('preferredHeightMaxCm')
            ? `${num('preferredHeightMinCm')} – ${num('preferredHeightMaxCm')} cm`
            : null}
        </Row>
      </Group>

      {assets.length > 0 && (
        <Group title="Family assets">
          {assets.map((a) => (
            <Row key={a.id} label={a.type.replace(/_/g, ' ')}>
              {[a.location, a.area, a.estimatedValue ? rupees(a.estimatedValue) : null]
                .filter(Boolean)
                .join(' · ') || '-'}
              {/* Family assets are private unless individually published. */}
              {!a.visible && <span className="ml-2 text-xs text-gray-400">(private)</span>}
            </Row>
          ))}
        </Group>
      )}

      {typeof details.updatedAt === 'string' && (
        <p className="text-xs text-gray-400">Last saved {formatDate(details.updatedAt)}</p>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      <dl className="divide-y">{children}</dl>
    </div>
  );
}

/** An empty value says "not set" — a blank row reads as a rendering failure. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div className="flex gap-3 py-1.5">
      <dt className="w-44 shrink-0 text-gray-500">{label}</dt>
      <dd className={empty ? 'text-gray-400' : 'font-medium text-gray-900'}>
        {empty ? 'Not set' : children}
      </dd>
    </div>
  );
}
