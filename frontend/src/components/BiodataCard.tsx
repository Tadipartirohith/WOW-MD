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
  const rows: [string, string | undefined][] = [
    ['Age', years ? `${years} years` : (profile.ageRange ?? undefined)],
    ['Gender', profile.gender],
    ['City', profile.city],
    ['Religion', profile.preferences?.religion],
    ['Community', profile.preferences?.community],
    ['Education', profile.preferences?.education],
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
          {profile.photos.slice(0, print ? 4 : 3).map((src) => (
            <img
              key={src}
              src={src}
              alt=""
              className="h-32 w-28 flex-none rounded-sm object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
              }}
            />
          ))}
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
