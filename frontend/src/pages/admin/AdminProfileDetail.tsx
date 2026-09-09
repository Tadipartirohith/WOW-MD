import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CaretLeft } from '@phosphor-icons/react';
import { api, apiMessage } from '../../lib/api';
import { formatDate } from '../../lib/dates';
import { EmptyState, Loading } from '../../components/ui/Feedback';

/**
 * One marriage profile in full (EZ1-I185).
 *
 * Reached by clicking a profile in an agency's (or any account's) associated
 * profiles list. It shows everything the platform holds — personal, contact,
 * stewardship, circulation, lifecycle, identity verification and matchmaking
 * activity — not just the matchmaking-facing subset the account page lists. The
 * government id number is never fetched; only the last four and who verified it.
 */

interface RelatedUser {
  id: string;
  email: string;
  role?: string;
  isActive?: boolean;
  isVerified?: boolean;
  phone?: string | null;
  createdAt?: string;
}

interface Preferences {
  religion?: string;
  community?: string;
  education?: string;
  lifestyle?: string[];
  preferredAgeMin?: number;
  preferredAgeMax?: number;
  preferredLocations?: string[];
}

interface ProfileDetail {
  profile: {
    id: string;
    profileCode: string;
    displayName: string;
    gender: string | null;
    dateOfBirth: string | null;
    city: string | null;
    address: string | null;
    bio: string | null;
    photos: string[];
    preferences: Preferences;
    contactEmail: string | null;
    contactPhone: string | null;
    stewardRelation: string | null;
    managingFor: string | null;
    claimStatus: string;
    networkVisibility: string;
    visibility: string;
    lifecycle: string;
    lifecycleReason: string | null;
    profileCompleted: boolean;
    lastActiveAt: string | null;
    pooledAt: string | null;
    governmentIdType: string | null;
    governmentIdLast4: string | null;
    idSubmittedAt: string | null;
    idVerifiedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  owner: RelatedUser | null;
  steward: RelatedUser | null;
  verifiedBy: RelatedUser | null;
  matchmaking: { sent: number; received: number; accepted: number; fixed: number };
}

const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

export default function AdminProfileDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery<ProfileDetail>({
    queryKey: ['admin-profile-detail', id],
    queryFn: async () => (await api.get(`/admin/profiles/${id}`)).data,
    retry: false,
  });

  const back = (
    <button onClick={() => navigate(-1)} className="btn-ghost btn-sm -ml-2 text-gray-500">
      <CaretLeft size={15} aria-hidden /> Back
    </button>
  );

  if (isLoading) return <Loading rows={6} />;
  if (error || !data)
    return (
      <div className="space-y-4">
        {back}
        <EmptyState title="Profile not found">
          {apiMessage(error, 'That profile could not be opened.')}
        </EmptyState>
      </div>
    );

  const p = data.profile;
  const prefs = p.preferences ?? {};
  const ageBand =
    prefs.preferredAgeMin || prefs.preferredAgeMax
      ? `${prefs.preferredAgeMin ?? '?'}–${prefs.preferredAgeMax ?? '?'}`
      : null;

  return (
    <div className="space-y-5">
      {back}

      <div className="card bg-gradient-to-br from-brand-soft to-surface">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-brand-strong">Marriage profile</p>
            <h1 className="page-title truncate">{p.displayName}</h1>
            <p className="page-subtitle font-mono">#{p.profileCode}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="pill bg-gray-100 text-gray-600">{p.lifecycle}</span>
            <span className={`pill ${p.profileCompleted ? 'bg-positive-bg text-positive-fg' : 'bg-caution-bg text-caution-fg'}`}>
              {p.profileCompleted ? 'Complete' : 'Incomplete'}
            </span>
            {p.idVerifiedAt && <span className="pill bg-positive-bg text-positive-fg">ID verified</span>}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Personal">
          <Row label="Display name">{p.displayName}</Row>
          <Row label="Gender">{dash(p.gender)}</Row>
          <Row label="Date of birth">{p.dateOfBirth ? formatDate(p.dateOfBirth) : '—'}</Row>
          <Row label="City">{dash(p.city)}</Row>
          <Row label="Address">{dash(p.address)}</Row>
        </Section>

        <Section title="Contact">
          <Row label="Email">{dash(p.contactEmail)}</Row>
          <Row label="Phone">{dash(p.contactPhone)}</Row>
          <Row label="Managed for">{dash(p.managingFor)}</Row>
          <Row label="Steward relation">{dash(p.stewardRelation)}</Row>
          <Row label="Claim status">{p.claimStatus}</Row>
        </Section>

        <Section title="Circulation & activity">
          <Row label="Network">{p.networkVisibility}</Row>
          <Row label="Visibility">{p.visibility}</Row>
          <Row label="Pooled">{p.pooledAt ? formatDate(p.pooledAt) : '—'}</Row>
          <Row label="Last active">{p.lastActiveAt ? formatDate(p.lastActiveAt) : '—'}</Row>
          <Row label="Registered">{formatDate(p.createdAt)}</Row>
        </Section>

        <Section title="Identity verification">
          <Row label="ID type">{dash(p.governmentIdType)}</Row>
          <Row label="ID (last 4)">{p.governmentIdLast4 ? `••••${p.governmentIdLast4}` : '—'}</Row>
          <Row label="Submitted">{p.idSubmittedAt ? formatDate(p.idSubmittedAt) : '—'}</Row>
          <Row label="Verified">{p.idVerifiedAt ? formatDate(p.idVerifiedAt) : '—'}</Row>
          {data.verifiedBy && <Row label="Verified by">{data.verifiedBy.email}</Row>}
        </Section>

        <Section title="Matchmaking">
          <Row label="Interests sent">{String(data.matchmaking.sent)}</Row>
          <Row label="Received">{String(data.matchmaking.received)}</Row>
          <Row label="Accepted">{String(data.matchmaking.accepted)}</Row>
          <Row label="Match fixed">{data.matchmaking.fixed > 0 ? 'Yes' : 'No'}</Row>
        </Section>

        <Section title="Account & stewardship">
          {data.owner ? (
            <Link className="btn-outline btn-sm mb-2 w-full justify-center" to={`/admin/clients/${data.owner.id}`}>
              Open owner account
            </Link>
          ) : (
            <Row label="Owner">Unclaimed</Row>
          )}
          {data.steward && (
            <Link
              className="btn-outline btn-sm w-full justify-center"
              to={`/admin/${data.steward.role === 'agent' ? 'agents' : 'clients'}/${data.steward.id}`}
            >
              Open steward ({data.steward.email})
            </Link>
          )}
        </Section>
      </div>

      {p.bio && (
        <div className="card">
          <h2 className="section-title mb-1">About</h2>
          <p className="whitespace-pre-line text-sm text-gray-700">{p.bio}</p>
        </div>
      )}

      {(prefs.religion ||
        prefs.community ||
        prefs.education ||
        ageBand ||
        (prefs.lifestyle?.length ?? 0) > 0 ||
        (prefs.preferredLocations?.length ?? 0) > 0) && (
        <div className="card">
          <h2 className="section-title mb-2">Partner preferences</h2>
          <div className="grid gap-1 sm:grid-cols-2">
            <Row label="Religion">{dash(prefs.religion)}</Row>
            <Row label="Community">{dash(prefs.community)}</Row>
            <Row label="Education">{dash(prefs.education)}</Row>
            <Row label="Age band">{dash(ageBand)}</Row>
            <Row label="Lifestyle">{dash(prefs.lifestyle?.join(', '))}</Row>
            <Row label="Locations">{dash(prefs.preferredLocations?.join(', '))}</Row>
          </div>
        </div>
      )}

      {p.photos.length > 0 && (
        <div className="card">
          <h2 className="section-title mb-2">Photos</h2>
          <div className="flex flex-wrap gap-2">
            {p.photos.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`${p.displayName} ${i + 1}`}
                className="h-24 w-24 rounded-md object-cover"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h2 className="section-title mb-2">{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="truncate text-right font-medium text-gray-900">{children}</span>
    </div>
  );
}
