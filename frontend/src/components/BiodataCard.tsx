import { useState } from 'react';

export interface Biodata {
  id: string;
  displayName: string;
  gender?: string;
  ageRange: string | null;
  dateOfBirth: string | null;
  city?: string;
  bio?: string;
  photos: string[];
  preferences?: {
    religion?: string;
    community?: string;
    education?: string;
    lifestyle?: string[];
  };
  /** The person's own basic biodata, shown on a shared link (EZ1-I135). */
  basic?: {
    religion: string | null;
    caste: string | null;
    subCaste: string | null;
    motherTongue: string | null;
    highestQualification: string | null;
    occupationStatus: string | null;
  } | null;
  managed: boolean;
}

/** Age from a date of birth, for the printed sheet where precision is expected. */
function age(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let years = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) years -= 1;
  return years;
}

/**
 * The biodata sheet, as an agent would recognise it.
 *
 * This is the fuller view — photos, exact age, community, education — because
 * it is only ever reached through a deliberate share. Contact details are still
 * absent: the agent brokers the introduction, that is the job.
 */
export default function BiodataCard({
  profile,
  print = false,
}: {
  profile: Biodata;
  print?: boolean;
}) {
  const years = age(profile.dateOfBirth);
  // Which photo is open full size, if any (EZ1-I23). Only interactive off the
  // printed sheet — a print has no click.
  const [preview, setPreview] = useState<string | null>(null);
  // The person's own basic biodata takes precedence over the search
  // preferences, so a shared link shows religion/caste/etc. and not just
  // name/age/city (EZ1-I135). Native place is deliberately absent here.
  const b = profile.basic;
  const rows: [string, string | undefined][] = [
    ['Age', years ? `${years} years` : (profile.ageRange ?? undefined)],
    ['Gender', profile.gender],
    ['City', profile.city],
    ['Religion', b?.religion ?? profile.preferences?.religion ?? undefined],
    ['Caste', b?.caste ?? undefined],
    ['Sub-caste', b?.subCaste ?? undefined],
    ['Mother tongue', b?.motherTongue ?? undefined],
    ['Qualification', b?.highestQualification ?? profile.preferences?.education ?? undefined],
    ['Occupation', b?.occupationStatus?.replace(/_/g, ' ') ?? undefined],
    ['Lifestyle', profile.preferences?.lifestyle?.join(', ')],
  ];

  return (
    <article className={print ? 'bg-white p-6' : 'card'}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="section-title">{profile.displayName}</h2>
          <p className="text-sm text-gray-500">
            {[years ? `${years} yrs` : profile.ageRange, profile.city].filter(Boolean).join(' · ')}
          </p>
        </div>
        {profile.managed && !print && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
            Via an agent
          </span>
        )}
      </header>

      {profile.photos.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {/* Every photo, clickable to full size in the interactive view (EZ1-I23).
              The printed sheet stays bounded so it does not run off the page. */}
          {(print ? profile.photos.slice(0, 4) : profile.photos).map((src) =>
            print ? (
              <img
                key={src}
                src={src}
                alt=""
                className="h-32 w-28 flex-none rounded-sm object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                }}
              />
            ) : (
              <button
                key={src}
                type="button"
                className="flex-none"
                onClick={() => setPreview(src)}
                aria-label="Open photo full size"
              >
                <img
                  src={src}
                  alt=""
                  className="h-32 w-28 rounded-sm object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                  }}
                />
              </button>
            ),
          )}
        </div>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setPreview(null)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 text-3xl leading-none text-white/80"
            aria-label="Close photo"
            onClick={() => setPreview(null)}
          >
            ×
          </button>
          <img
            src={preview}
            alt=""
            className="max-h-full max-w-full rounded-sm object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {rows
          .filter(([, v]) => Boolean(v))
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-gray-400">{label}</dt>
              <dd className="text-gray-700">{value}</dd>
            </div>
          ))}
      </dl>

      {profile.bio && <p className="mt-3 text-sm text-gray-600">{profile.bio}</p>}

      {print && (
        <p className="mt-6 border-t pt-3 text-xs text-gray-400">
          Shared through WOW, World of Weddings. Please contact the agent who sent you this to take
          it further.
        </p>
      )}
    </article>
  );
}
