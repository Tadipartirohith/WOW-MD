import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, Storefront } from '@phosphor-icons/react';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { useBusinesses } from '../store/business';
import { Permission, can } from '../lib/permissions';
import BusinessSetup from './BusinessSetup';

/**
 * What a business still has to do before anybody can find it.
 *
 * Signing up creates an *account*. It does not create a listing, and a listing
 * is what a couple searches. Nothing said so: a vendor registered, landed on
 * this dashboard, and saw a page of zeroes with no indication that the product
 * was waiting on them. They concluded the platform was broken — and the record
 * bears it out, with thirty-four vendor listings sitting in draft and a
 * vendor account holding no listing at all wondering why no verification
 * request ever reached an administrator.
 *
 * Everything here is read from the server rather than inferred. The vendor
 * checklist is `completion()`, which is the same thing the submit gate refuses
 * on, so this panel cannot tell somebody they are ready and then have the
 * button disagree.
 *
 * It disappears when the business is live. A permanent banner on a finished
 * account is the reason people stop reading banners.
 */
export default function GetStarted() {
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const isVendor = can(permissions, Permission.VENDOR_LISTING_MANAGE);
  const isPlanner = can(permissions, Permission.PLANNER_LISTING_MANAGE);

  const { businesses, active, isLoading } = useBusinesses();

  // 404 is the first-run answer here, not a failure: a planner who has not
  // written their listing yet has no row to return.
  const { data: planner, isPending: plannerLoading } = useQuery({
    queryKey: ['planner-me'],
    queryFn: async () => (await api.get('/wedding-planners/me')).data,
    enabled: isPlanner && !isVendor,
    retry: false,
  });

  if (!isVendor && !isPlanner) return null;
  if (isVendor && isLoading) return null;
  if (isPlanner && !isVendor && plannerLoading) return null;

  if (isVendor) {
    // No listing at all. The console holds the form; what was missing was
    // anything telling somebody the form existed.
    if (businesses.length === 0) return <Step
      title="Your business is not listed yet"
      body="Signing up made your account. A listing is the thing couples search, and yours has not been written. It takes a few minutes and nothing reaches an administrator until it exists."
      cta="Create your listing"
    />;

    if (active?.status === 'live') return null;

    if (active?.status === 'pending_verification') return <Step
      title="Submitted, and waiting on a visit"
      body="An officer will be allocated to verify the address you gave. Nothing more is needed from you until they get in touch."
      cta="See your business"
      tone="calm"
    />;

    // In draft: the checklist is the useful thing, and it already exists.
    return active ? <BusinessSetup businessId={active.id} /> : null;
  }

  // A planner has one listing and no catalog, so there is no checklist to
  // render — either it exists and is waiting on approval, or it does not.
  if (!planner) return <Step
    title="Your planning business is not listed yet"
    body="Signing up made your account. Couples search listings, not accounts, so nothing can reach you until you have written yours."
    cta="Create your listing"
  />;

  if (planner.isApproved) return null;

  return <Step
    title="Waiting on approval"
    body="Your listing has gone to the administrators. Couples cannot see it until it is approved, and you do not need to do anything else in the meantime."
    cta="See your listing"
    tone="calm"
  />;
}

function Step({
  title,
  body,
  cta,
  tone = 'action',
}: {
  title: string;
  body: string;
  cta: string;
  tone?: 'action' | 'calm';
}) {
  return (
    <div
      className={`card border-l-4 ${
        tone === 'action' ? 'border-l-brand' : 'border-l-gray-300'
      }`}
    >
      <div className="flex items-start gap-3">
        <Storefront
          size={20}
          className={tone === 'action' ? 'mt-0.5 shrink-0 text-brand' : 'mt-0.5 shrink-0 text-gray-400'}
          aria-hidden
        />
        <div className="flex-1">
          <h2 className="section-title">{title}</h2>
          <p className="mt-1 text-sm text-gray-600">{body}</p>
          <Link
            className={`mt-3 inline-flex items-center gap-1 text-sm font-medium ${
              tone === 'action' ? 'text-brand-strong' : 'text-gray-600'
            }`}
            to="/console"
          >
            {cta}
            <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );
}
