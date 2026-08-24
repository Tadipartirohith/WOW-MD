import { useQuery } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { formatDate } from '../lib/dates';

interface Viewable {
  profileId: string;
  profile: {
    id: string;
    displayName: string | null;
    city: string | null;
    gender: string | null;
    dateOfBirth: string | null;
    photos: string[];
    bio: string | null;
    identityVerified: boolean;
  };
  details: Record<string, unknown> | null;
  siblings: { id: string; name: string; profession?: string | null }[];
  assets: { id: string; type: string; location?: string | null }[];
}

/**
 * A profile, opened from wherever it was listed.
 *
 * Matches, recommendations and interests all showed a name, a city and an age
 * range and stopped there — the name was not clickable and there was nothing
 * behind it, because the endpoint that serves a viewable biodata existed and
 * had never been exposed. That is the whole of the reported defect.
 *
 * What is shown is the subtractive view the server decides: no income unless
 * the profile publishes it, no communication address, no second phone number.
 * This component does not choose what to hide — it renders what it is given,
 * which is the only arrangement where the two cannot drift apart.
 */
export default function ProfilePreview({
  profileId,
  onClose,
  onSendInterest,
}: {
  profileId: string;
  onClose: () => void;
  onSendInterest?: () => void;
}) {
  const { data, isLoading, isError, error } = useQuery<Viewable>({
    queryKey: ['viewable-profile', profileId],
    queryFn: async () => (await api.get(`/profiles/${profileId}/view`)).data,
    retry: false,
  });

  const d = (data?.details ?? {}) as Record<string, unknown>;
  const str = (key: string) => {
    const v = d[key];
    return v === null || v === undefined || v === '' ? null : String(v);
  };
  const bag = (key: string) => (d[key] ?? {}) as Record<string, unknown>;

  const age = (() => {
    const dob = data?.profile.dateOfBirth;
    if (!dob) return null;
    const born = new Date(dob);
    if (Number.isNaN(born.getTime())) return null;
    const now = new Date();
    let years = now.getFullYear() - born.getFullYear();
    if (
      now.getMonth() < born.getMonth() ||
      (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())
    ) {
      years -= 1;
    }
    return years > 0 ? years : null;
  })();

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-8 w-full max-w-2xl rounded-lg bg-white p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900">
            {data?.profile.displayName ?? 'Profile'}
          </h2>
          <button className="text-2xl leading-none text-gray-400" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {isLoading && <p className="text-sm text-gray-400">Loading…</p>}
        {isError && (
          <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">
            {apiMessage(error, 'That profile cannot be opened.')}
          </p>
        )}

        {data && (
          <div className="space-y-5">
            {data.profile.photos.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {data.profile.photos.slice(0, 5).map((url) => (
                  <img
                    key={url}
                    src={url}
                    alt=""
                    loading="lazy"
                    className="h-32 w-32 rounded object-cover ring-1 ring-gray-200"
                  />
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
              {age && <span>{age} years</span>}
              {str('heightCm') && <span>· {str('heightCm')} cm</span>}
              {data.profile.city && <span>· {data.profile.city}</span>}
              {/* The thing families ask about before anything else. */}
              {data.profile.identityVerified && (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
                  Identity verified
                </span>
              )}
            </div>

            {data.profile.bio && (
              <p className="whitespace-pre-wrap text-sm text-gray-700">{data.profile.bio}</p>
            )}

            <Group title="Religion and community">
              <Row label="Religion">{str('religion')}</Row>
              <Row label="Caste">{str('caste')}</Row>
              <Row label="Sub-caste">{str('subCaste')}</Row>
              <Row label="Mother tongue">{str('motherTongue')}</Row>
            </Group>

            <Group title="Education and occupation">
              <Row label="Qualification">{str('highestQualification')}</Row>
              <Row label="Course">{str('course')}</Row>
              <Row label="Occupation">{str('occupationStatus')?.replace(/_/g, ' ')}</Row>
              <Row label="Employer">
                {String(bag('employment').company ?? bag('business').businessName ?? '') || null}
              </Row>
            </Group>

            <Group title="Family">
              <Row label="Native place">{str('nativePlace')}</Row>
              <Row label="Father">{String(bag('father').name ?? '') || null}</Row>
              <Row label="Mother">{String(bag('mother').name ?? '') || null}</Row>
              <Row label="Family type">{str('familyType')}</Row>
              {data.siblings.length > 0 && (
                <Row label="Siblings">
                  {data.siblings.map((s) => s.name).filter(Boolean).join(', ')}
                </Row>
              )}
            </Group>

            <Group title="Horoscope">
              <Row label="Has a horoscope">
                {d.horoscopeAvailable === null || d.horoscopeAvailable === undefined
                  ? null
                  : d.horoscopeAvailable
                    ? 'Yes'
                    : 'No'}
              </Row>
              {Boolean(d.horoscopeAvailable) && (
                <>
                  <Row label="Rashi">{String(bag('horoscope').rashi ?? '') || null}</Row>
                  <Row label="Star">{String(bag('horoscope').star ?? '') || null}</Row>
                </>
              )}
            </Group>

            <Group title="Marital status">
              <Row label="Status">{str('maritalStatus')?.replace(/_/g, ' ')}</Row>
              <Row label="Married on">
                {formatDate(String(bag('maritalHistory').marriageDate ?? ''), '')}
              </Row>
            </Group>

            {onSendInterest && (
              <button
                className="btn"
                onClick={() => {
                  onSendInterest();
                  onClose();
                }}
              >
                Send interest
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      <dl className="divide-y text-sm">{children}</dl>
    </div>
  );
}

/** An empty value says so, rather than rendering a blank row that reads as broken. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div className="flex gap-3 py-1.5">
      <dt className="w-40 shrink-0 text-gray-500">{label}</dt>
      <dd className={empty ? 'text-gray-400' : 'font-medium text-gray-900'}>
        {empty ? 'Not shared' : children}
      </dd>
    </div>
  );
}
