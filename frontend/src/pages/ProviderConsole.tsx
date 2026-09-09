import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import BusinessSetup, { useCompletion } from '../components/BusinessSetup';
import GetStarted from '../components/GetStarted';
import ChoiceField from '../components/ChoiceField';
import { CITIES, STATES } from '../lib/reference';
import { useAuth } from '../store/auth';
import { useBusinesses } from '../store/business';
import VendorServices, { priceLabel } from '../components/VendorServices';
import PhotoUploader from '../components/PhotoUploader';
import {
  CORRECTION_FIELD_LABELS,
  GSTIN_PATTERN,
  PAN_PATTERN,
  Permission,
  VENDOR_CATEGORIES,
  can,
} from '../lib/permissions';

const CATEGORY_LABEL: Record<string, string> = {
  venue: 'Venue',
  catering: 'Catering',
  photography: 'Photography',
  decor: 'Decor',
  makeup: 'Makeup',
  entertainment: 'Entertainment',
  other: 'Other',
};

/**
 * The seller-side workspace, shared by vendors and wedding planners. Which
 * listing form renders is decided by the caller's capability, not by a role
 * string, so the two personas stay in one screen without special-casing.
 */
export default function ProviderConsole() {
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const isVendor = can(permissions, Permission.VENDOR_LISTING_MANAGE);

  const { data: listing } = useQuery({
    queryKey: ['my-listing', isVendor],
    queryFn: async () =>
      isVendor ? (await api.get('/vendors/me')).data : (await api.get('/wedding-planners/me')).data,
    // A provider who has not created a listing yet gets a 404; that is a normal
    // first-run state, not an error worth retrying.
    retry: false,
  });

  // Which business this page is about comes from the header's switcher, not
  // from `listings[0]`. An account with two businesses could previously only
  // ever edit the first one from here.
  const { activeId } = useBusinesses();
  const vendorId: string | undefined = isVendor ? (activeId ?? undefined) : undefined;
  const current = isVendor
    ? ((listing as VendorListing[] | undefined) ?? []).find((l) => l.id === vendorId)
    : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">My Business</h1>
        <p className="page-subtitle">
          Your shop window: who you are, what you sell and what it costs. Your calendar and the
          work coming in have their own pages. This one is only about the business.
        </p>
      </div>

      {/*
        The sequence first, the form under it.
        
        A vendor arriving here needs to know what this listing still needs and
        what happens when it has it, before being handed a form. All of it was
        already worked out on the server and none of it was on the screen.
      */}
      {/*
        What is still outstanding, for whoever is looking.

        BusinessSetup needs a business to describe, so a vendor who has not
        created one yet fell through it and got a bare form with no statement
        of what the form was for. GetStarted covers that case, and the planner
        case BusinessSetup never covered at all.
      */}
      {isVendor && current?.status === 'rejected' ? (
        // A rejected listing is locked: no set-up, no availability, no services —
        // only the way to contact support (EZ1-I119). The backend enforces this
        // too, so a hidden form is not the whole of the restriction.
        <div className="card space-y-3">
          <h2 className="section-title text-red-700">This listing was rejected</h2>
          {current.decisionReason && (
            <p className="whitespace-pre-wrap text-sm text-gray-700">{current.decisionReason}</p>
          )}
          <p className="text-sm text-gray-600">
            The account is locked while it is rejected — Business Details, Services, Availability and
            Bookings cannot be changed. If you think this is a mistake, raise it on Support.
          </p>
          <Link className="btn w-fit" to="/support">
            Contact support
          </Link>
        </div>
      ) : isVendor ? (
        <>
          {/*
            The whole "My Business" set-up as one guided sequence
            (EZ1-I21): Business Details -> Catalog & Services -> Offerings &
            Pricing -> Review & Submit. Each step reuses the piece that already
            owned it; the wizard only sequences them and carries the server's
            lock and status rules between the steps.
          */}
          <VendorBusinessWizard vendorId={vendorId} current={current} />
        </>
      ) : (
        <>
          {vendorId ? <BusinessSetup businessId={vendorId} /> : <GetStarted />}
          <PlannerListingForm existing={listing} />
        </>
      )}
      {/*
        Reviews live on their own My Reviews page (EZ1-I103); the payout account
        lives on Accounts (EZ1-I100); Availability and Bookings are their own
        navbar modules (EZ1-I105). None of them belong on My Business, which is
        only about the shop window.
      */}
    </div>
  );
}

interface VendorListing {
  id: string;
  name: string;
  category: string;
  otherCategory: string | null;
  city: string;
  description: string;
  gstNumber: string | null;
  panNumber: string | null;
  registrationNumber: string | null;
  tradingSince: string | null;
  registeredAddress: string | null;
  contactPhone: string | null;
  portfolio: string[];
  complianceDocuments: string[];
  isApproved: boolean;
  payoutAccountId: string | null;
  /** Where this business is in its life, from draft to live. */
  status: string;
  decisionReason: string | null;
  /**
   * When an administrator asked for a targeted correction (EZ1-I205), exactly
   * which fields the vendor may change before resubmitting. Null/empty means the
   * listing was reopened in full, or is not under a correction at all.
   */
  correctionFields?: string[] | null;
}

const WIZARD_STEPS = [
  { key: 'business', label: 'Business Details' },
  // Services and their offerings & pricing are one step now (EZ1-I96).
  { key: 'catalog', label: 'Catalog & Services' },
  { key: 'review', label: 'Review & Submit' },
] as const;

/**
 * "My Business" as one guided sequence (EZ1-I21).
 *
 * The steps are wiring, not new logic: Business Details is the listing form,
 * Catalog & Services and Offerings & Pricing are the services manager, and
 * Review is the server's own completion checklist plus Submit for Verification.
 * The server owns the lock and the state machine — the identity form goes
 * read-only once submitted and opens again if the listing is sent back, the
 * catalog stays editable throughout — and this only walks the vendor through it
 * in order rather than handing over one long page.
 */
function VendorBusinessWizard({
  vendorId,
  current,
}: {
  vendorId?: string;
  current?: VendorListing;
}) {
  const [step, setStep] = useState(0);
  // A step requested before the just-saved business has finished loading; the
  // effect below advances to it the moment `hasBusiness` becomes true, so
  // "Save & Continue" on a brand-new listing lands on step two rather than
  // silently doing nothing.
  const [pendingStep, setPendingStep] = useState<number | null>(null);
  const hasBusiness = Boolean(vendorId && current);

  // Once the listing is verified or live there is nothing left to submit, so the
  // Review & Submit step is dropped rather than shown with a stale "being
  // verified" note over a listing that already is (EZ1-I207).
  const isVerifiedLive = current?.status === 'verified' || current?.status === 'live';
  const steps = isVerifiedLive ? WIZARD_STEPS.filter((s) => s.key !== 'review') : WIZARD_STEPS;

  useEffect(() => {
    if (pendingStep !== null && (pendingStep === 0 || hasBusiness)) {
      setStep(Math.max(0, Math.min(steps.length - 1, pendingStep)));
      setPendingStep(null);
    }
  }, [pendingStep, hasBusiness]);

  // Steps past the first need a saved business to attach services to. If one is
  // requested before that business has loaded, remember it and let the effect
  // advance once it has.
  const go = (n: number) => {
    if (n > 0 && !hasBusiness) {
      setPendingStep(n);
      return;
    }
    setStep(Math.max(0, Math.min(steps.length - 1, n)));
  };

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-2">
        {steps.map((s, i) => {
          const disabled = i > 0 && !hasBusiness;
          const tone =
            i === step
              ? 'bg-brand text-white'
              : i < step
                ? 'bg-brand-soft text-brand-strong'
                : 'bg-surface-sunken text-gray-500';
          return (
            <li key={s.key}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => go(i)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${tone} ${
                  disabled ? 'cursor-not-allowed opacity-50' : ''
                }`}
              >
                {i + 1}. {s.label}
              </button>
            </li>
          );
        })}
      </ol>

      {/*
        The officer's own words when a listing is sent back — the vendor cannot
        fix what nobody named. Read from the owner-only route, so a competitor
        cannot look it up.
      */}
      {current?.decisionReason && (
        <div className="rounded-sm border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
            {current.correctionFields && current.correctionFields.length > 0
              ? 'Correction required'
              : 'What needs fixing'}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-amber-900">{current.decisionReason}</p>
          {/*
            When the send-back was targeted, name the fields the vendor may edit.
            The lock on everything else is enforced by the server; this only says
            which fields are open so the vendor is not hunting for them.
          */}
          {current.correctionFields && current.correctionFields.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium text-amber-800">You can edit only:</p>
              <ul className="mt-1 flex flex-wrap gap-1">
                {current.correctionFields.map((f) => (
                  <li
                    key={f}
                    className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900"
                  >
                    {CORRECTION_FIELD_LABELS[f] ?? f}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {step === 0 && (
        <div className="space-y-3">
          <VendorListingForm existing={current ? [current] : []} onSaved={() => go(1)} />
          {hasBusiness && (
            <div className="flex justify-end">
              <button type="button" className="btn" onClick={() => go(1)}>
                Continue to Catalog &amp; Services →
              </button>
            </div>
          )}
        </div>
      )}

      {step === 1 && vendorId && (
        <div className="space-y-3">
          {/*
            Services and their offerings & pricing are managed together here
            (EZ1-I96): one step, not two. VendorServices already owns both — the
            services list and each service's packages, prices and capacity.
          */}
          <StepIntro>
            Pick the services you offer, then add packages, pricing and capacity to each. This is
            what a buyer sees and what a quotation is built from.
          </StepIntro>
          <VendorServices vendorId={vendorId} />
          {/* No Review & Submit once verified/live — there is nothing left to
              submit, so the step and its button are both gone (EZ1-I207). */}
          <WizardNav
            onBack={() => go(0)}
            onNext={isVerifiedLive ? undefined : () => go(2)}
            nextLabel="Review & Submit →"
          />
        </div>
      )}

      {step === 2 && !isVerifiedLive && vendorId && current && (
        <div className="space-y-3">
          <ReviewSummary current={current} />
          {/*
            The checklist and the two-step Submit for Verification are the
            server's, reused verbatim: it decides what is still missing and locks
            the listing on submit.
          */}
          <BusinessSetup businessId={vendorId} />
          <WizardNav onBack={() => go(1)} onEdit={() => go(0)} />
        </div>
      )}
    </div>
  );
}

function StepIntro({ children }: { children: ReactNode }) {
  return <p className="rounded-sm bg-surface-sunken px-3 py-2 text-sm text-gray-600">{children}</p>;
}

function WizardNav({
  onBack,
  onNext,
  onEdit,
  nextLabel,
}: {
  onBack?: () => void;
  onNext?: () => void;
  onEdit?: () => void;
  nextLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
      <div>
        {onBack && (
          <button type="button" className="btn-outline" onClick={onBack}>
            ← Back
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {onEdit && (
          <button type="button" className="btn-outline" onClick={onEdit}>
            Edit business details
          </button>
        )}
        {onNext && (
          <button type="button" className="btn" onClick={onNext}>
            {nextLabel ?? 'Next →'}
          </button>
        )}
      </div>
    </div>
  );
}

/** A vendor service and its priced offerings, as the review reads them (EZ1-I152). */
interface ReviewService {
  id: string;
  displayName: string | null;
  description: string | null;
  definition: { name?: string } | null;
  category: { name?: string } | null;
  offerings: {
    id: string;
    name: string;
    pricingModel: string;
    price: string | null;
    currency: string;
    unitLabel: string | null;
  }[];
}

/** The whole listing, read-only, before it is submitted for verification. */
function ReviewSummary({ current }: { current: VendorListing }) {
  const category =
    current.category === 'other'
      ? (current.otherCategory ?? 'Other')
      : (CATEGORY_LABEL[current.category] ?? current.category);

  // The catalog the vendor actually built, so Review is the complete submission
  // rather than a count of it — no "2 Services" / "3 Documents" (EZ1-I152).
  const { data: services = [] } = useQuery<ReviewService[]>({
    queryKey: ['vendor-services', current.id],
    queryFn: async () => (await api.get(`/vendors/${current.id}/services`)).data,
    enabled: Boolean(current.id),
    retry: false,
  });

  const portfolio = current.portfolio ?? [];
  const documents = current.complianceDocuments ?? [];

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="section-title">Review</h2>
        <p className="text-sm text-gray-600">
          Everything you have entered, read-only. Go back to change anything, then submit for
          verification below.
        </p>
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Detail label="Business name">{current.name}</Detail>
        <Detail label="Category">{category}</Detail>
        <Detail label="City">{current.city || 'Not provided'}</Detail>
        <Detail label="PAN">{current.panNumber ?? 'Not provided'}</Detail>
        <Detail label="GST number">{current.gstNumber ?? 'Not provided'}</Detail>
        <Detail label="Registration number">{current.registrationNumber ?? 'Not provided'}</Detail>
        <Detail label="Trading since">
          {current.tradingSince
            ? new Date(current.tradingSince).toLocaleDateString()
            : 'Not provided'}
        </Detail>
        <Detail label="Registered address">{current.registeredAddress ?? 'Not provided'}</Detail>
        <Detail label="Contact number">{current.contactPhone ?? 'Not provided'}</Detail>
      </dl>

      {current.description && (
        <div className="border-t pt-3">
          <p className="mb-1 text-sm font-medium text-gray-900">Description</p>
          <p className="text-sm text-gray-700">{current.description}</p>
        </div>
      )}

      {/* The actual portfolio images, not a count of them (EZ1-I152). */}
      <div className="border-t pt-3">
        <p className="mb-1 text-sm font-medium text-gray-900">
          Portfolio ({portfolio.length})
        </p>
        {portfolio.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {portfolio.map((url) => (
              <img
                key={url}
                src={url}
                alt=""
                className="h-20 w-28 rounded-sm object-cover"
                loading="lazy"
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-amber-700">No photos added yet.</p>
        )}
      </div>

      {/* Each compliance document by name, as a link (EZ1-I152). */}
      <div className="border-t pt-3">
        <p className="mb-1 text-sm font-medium text-gray-900">
          Compliance documents ({documents.length})
        </p>
        {documents.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {documents.map((url, i) => (
              <li key={url}>
                <a
                  className="text-sm text-brand-strong underline"
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {decodeURIComponent(url.split('/').pop() ?? `Document ${i + 1}`)}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-amber-700">No documents uploaded yet.</p>
        )}
      </div>

      {/* Catalogs, services and their priced offerings in full (EZ1-I152). */}
      {services.length > 0 && (
        <div className="border-t pt-3">
          <p className="mb-2 text-sm font-medium text-gray-900">
            Catalog &amp; services ({services.length})
          </p>
          <div className="space-y-2">
            {services.map((svc) => (
              <div key={svc.id} className="rounded-sm bg-gray-50 p-2">
                <p className="text-sm font-medium text-gray-800">
                  {svc.displayName ?? svc.definition?.name ?? 'Service'}
                  {svc.category?.name && (
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      {svc.category.name}
                    </span>
                  )}
                </p>
                {svc.description && (
                  <p className="mt-0.5 text-xs text-gray-600">{svc.description}</p>
                )}
                {svc.offerings.length > 0 ? (
                  <ul className="mt-1 space-y-0.5 text-sm text-gray-700">
                    {svc.offerings.map((off) => (
                      <li key={off.id} className="flex justify-between gap-3">
                        <span>{off.name}</span>
                        <span className="tabular-nums text-gray-600">{priceLabel(off)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-gray-400">No offerings priced yet.</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const emptyListing = {
  name: '',
  // No category is pre-selected — the vendor must choose one rather than have
  // "Venue" default in on their behalf (EZ1-I152).
  category: '',
  otherCategory: '',
  city: '',
  description: '',
  gstNumber: '',
  panNumber: '',
  registrationNumber: '',
  tradingSince: '',
  registeredAddress: '',
  contactPhone: '',
};

/**
 * The business record.
 *
 * Saved details are shown back as a record, not as a form pre-filled with them:
 * a vendor opening this page wants to check what the platform is telling
 * clients about them, and a page that only ever offers an edit form makes that
 * check look like an invitation to change something.
 */
function VendorListingForm({
  existing,
  onSaved,
}: {
  existing?: VendorListing[];
  /** Wizard hook: advance to the next step after a successful save. */
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const current = existing?.[0];
  /*
   * Whether this listing may still be edited, asked of the server.
   *
   * The API already refuses an edit once a listing is submitted — a vendor who
   * changes their GST number after an officer has been sent to check it has
   * verified nothing — but the button was still there, so the refusal arrived
   * after the click. Read rather than re-derived: a second copy of the state
   * rules here would be the copy that goes wrong.
   */
  const { data: completion } = useCompletion(current?.id);
  const locked = completion ? !completion.rules.editIdentity : false;
  // Verified/live: the legally-checked fields are locked, but about, contact and
  // portfolio stay the vendor's to change (EZ1-I207). When this is true the Edit
  // form shows only those and the locked fields get a Request a change route.
  const presentationalOnly = locked && (completion?.rules.editPresentational ?? false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(emptyListing);
  const [portfolio, setPortfolio] = useState<string[]>([]);
  const [documents, setDocuments] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!current) {
      setEditing(true);
      return;
    }
    // A submitted listing opens read-only, whatever was on screen before.
    if (locked) setEditing(false);
    setForm({
      name: current.name ?? '',
      category: current.category ?? '',
      otherCategory: current.otherCategory ?? '',
      city: current.city ?? '',
      description: current.description ?? '',
      gstNumber: current.gstNumber ?? '',
      panNumber: current.panNumber ?? '',
      registrationNumber: current.registrationNumber ?? '',
      tradingSince: current.tradingSince ?? '',
      registeredAddress: current.registeredAddress ?? '',
      contactPhone: current.contactPhone ?? '',
    });
    setPortfolio(current.portfolio ?? []);
    setDocuments(current.complianceDocuments ?? []);
  }, [current]);

  /** Field-level, and specific about what is wrong rather than "invalid". */
  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = 'Your business needs a name';
    // Category, city, registered address, a portfolio image and a compliance
    // document are all mandatory to submit a listing for verification
    // (EZ1-I152) — an officer cannot verify a business that has named none of
    // them.
    if (!form.category) errors.category = 'Choose a category';
    if (form.category === 'other' && !form.otherCategory.trim()) {
      errors.otherCategory = 'Say what you do, so clients can find you';
    }
    if (!form.city.trim()) errors.city = 'A city is required';
    if (!form.registeredAddress.trim()) {
      errors.registeredAddress = 'A registered address is required — it is where the officer visits';
    }
    if (portfolio.length === 0) {
      errors.portfolio = 'Add at least one portfolio photo';
    }
    if (documents.length === 0) {
      errors.complianceDocuments = 'Upload at least one compliance document';
    }
    if (form.gstNumber && !GSTIN_PATTERN.test(form.gstNumber.toUpperCase())) {
      errors.gstNumber = 'A GSTIN is 15 characters, like 29ABCDE1234F1Z5';
    }
    /*
     * PAN is required; GST and the registration number are not.
     *
     * The platform invoices against the PAN and cannot pay anybody out
     * without one, so a listing that reaches verification without it is a
     * listing that cannot be paid. Plenty of legitimate small businesses have
     * no GST registration and no company number, and refusing those would
     * turn away exactly the vendors this marketplace is for.
     */
    if (!form.panNumber.trim()) {
      errors.panNumber = 'A PAN is required — it is what payouts are made against';
    } else if (!PAN_PATTERN.test(form.panNumber.toUpperCase())) {
      errors.panNumber = 'A PAN is 10 characters, like ABCDE1234F';
    }
    // Contact mobile is mandatory (EZ1-I21): it is how a client and a
    // verification officer reach the business.
    if (!form.contactPhone.trim()) {
      errors.contactPhone = 'A contact mobile number is required';
    } else if (!/^(\+91)?[6-9]\d{9}$/.test(form.contactPhone.replace(/\s|-/g, ''))) {
      errors.contactPhone = 'Enter a 10-digit Indian mobile number';
    }
    return errors;
  }

  /**
   * The lighter check for a verified/live listing (EZ1-I207): only the fields
   * the backend still lets change are on screen, so only those are validated.
   */
  function validatePresentational(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (portfolio.length === 0) errors.portfolio = 'Add at least one portfolio photo';
    if (!form.contactPhone.trim()) {
      errors.contactPhone = 'A contact mobile number is required';
    } else if (!/^(\+91)?[6-9]\d{9}$/.test(form.contactPhone.replace(/\s|-/g, ''))) {
      errors.contactPhone = 'Enter a 10-digit Indian mobile number';
    }
    return errors;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    const errors = presentationalOnly ? validatePresentational() : validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    try {
      // A verified/live listing may only change the presentational fields, so
      // the payload carries just those — the legal fields are not sent, not
      // merely disabled (EZ1-I207).
      const payload: Record<string, unknown> = presentationalOnly
        ? {
            description: form.description.trim(),
            contactPhone: form.contactPhone.trim(),
            portfolio,
          }
        : {
            name: form.name.trim(),
            category: form.category,
            // Portfolio is deliberately always sent, including empty: clearing
            // the last photo has to be able to reach the server.
            portfolio,
            complianceDocuments: documents,
          };
      if (!presentationalOnly) {
        if (form.category === 'other') payload.otherCategory = form.otherCategory.trim();
        for (const key of [
          'city',
          'description',
          'gstNumber',
          'panNumber',
          'registrationNumber',
          'tradingSince',
          'registeredAddress',
          'contactPhone',
        ] as const) {
          // An empty string is not "not provided" — sending one fails the format
          // checks on GST and PAN, so blanks are dropped instead.
          if (form[key]) payload[key] = form[key];
        }
      }

      if (current) await api.put(`/vendors/${current.id}`, payload);
      else await api.post('/vendors', payload);

      setMsg(
        presentationalOnly
          ? 'Saved. Your listing stays live and the change is visible to couples now.'
          : 'Saved. A verification officer visits the registered address before the listing goes live.',
      );
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['my-listing'] });
      qc.invalidateQueries({ queryKey: ['business-completion'] });
      // The business switcher drives which listing the wizard is about; without
      // refreshing it, a just-created first listing never becomes "active" and
      // the wizard cannot leave step one.
      qc.invalidateQueries({ queryKey: ['businesses'] });
      // The dashboard and the header switcher read the business off ['vendor-me']
      // (via useBusinesses), which the always-mounted header keeps alive — so
      // without invalidating it here, the saved name/status never reached the
      // dashboard until a full refresh (EZ1-I118).
      qc.invalidateQueries({ queryKey: ['vendor-me'] });
      // The dashboard greeting and profile-completion come off /users/me.
      qc.invalidateQueries({ queryKey: ['me'] });
      // In the wizard, a successful save moves straight to the next step — no
      // page refresh, the listing is created/updated in place (EZ1-I21).
      onSaved?.();
    } catch (err) {
      setMsg(apiMessage(err, 'Could not save the listing.'));
    }
  }

  const set = (k: keyof typeof emptyListing) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  if (current && !editing) {
    return (
      <div className="card space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="section-title">{current.name}</h2>
            <p className="text-sm text-gray-600">
              {current.category === 'other'
                ? (current.otherCategory ?? 'Other')
                : (CATEGORY_LABEL[current.category] ?? current.category)}
              {current.city ? ` \u00b7 ${current.city}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-1 text-xs ${
                current.isApproved
                  ? 'bg-emerald-50 text-emerald-800'
                  : 'bg-amber-50 text-amber-800'
              }`}
            >
              {current.isApproved ? 'Live in search' : 'Awaiting verification'}
            </span>
            {!locked ? (
              <button className="btn-outline" onClick={() => setEditing(true)}>
                Edit
              </button>
            ) : presentationalOnly ? (
              // Verified/live: the presentational fields are still editable, so
              // offer that rather than a dead "locked" label (EZ1-I207).
              <button className="btn-outline" onClick={() => setEditing(true)}>
                Edit details
              </button>
            ) : (
              <span
                className="text-xs text-gray-500"
                title={completion?.rules.note}
              >
                Locked while it is verified
              </span>
            )}
          </div>
        </div>

        {msg && <p className="rounded-sm bg-brand-light p-2 text-sm text-brand-dark">{msg}</p>}
        {current.description && <p className="text-sm text-gray-700">{current.description}</p>}

        <dl className="grid gap-x-6 gap-y-2 border-t pt-3 text-sm sm:grid-cols-2">
          <Detail label="GST number">{current.gstNumber ?? 'Not provided'}</Detail>
          <Detail label="PAN">{current.panNumber ?? 'Not provided'}</Detail>
          <Detail label="Registration number">
            {current.registrationNumber ?? 'Not provided'}
          </Detail>
          <Detail label="Trading since">
            {current.tradingSince
              ? new Date(current.tradingSince).toLocaleDateString()
              : 'Not provided'}
          </Detail>
          <Detail label="Registered address">
            {current.registeredAddress ?? 'Not provided'}
          </Detail>
          <Detail label="Contact number">{current.contactPhone ?? 'Not provided'}</Detail>
        </dl>

        {current.portfolio?.length > 0 && (
          <div className="border-t pt-3">
            <p className="mb-2 text-sm font-medium text-gray-900">Portfolio</p>
            <div className="flex flex-wrap gap-2">
              {current.portfolio.map((url) => (
                <img
                  key={url}
                  src={url}
                  alt=""
                  className="h-20 w-28 rounded-sm object-cover"
                  loading="lazy"
                />
              ))}
            </div>
          </div>
        )}

        {/*
          The verified details are locked, but a business does move — a firm
          re-registers, an address changes. Rather than a dead editable input,
          the vendor raises the change and the team reopens the listing through
          the same correction/reverification path an officer uses (EZ1-I207).
        */}
        {presentationalOnly && <RequestChange vendorId={current.id} />}
      </div>
    );
  }

  if (current && editing && presentationalOnly) {
    return (
      <form onSubmit={submit} className="card space-y-3" noValidate>
        <h2 className="section-title">Edit your listing</h2>
        <p className="text-sm text-gray-600">
          Your listing is verified. About, contact number and photos are yours to change and go
          live straight away. The verified details — name, category, PAN, GST, registration and
          address — are locked; use “Request a change” for those.
        </p>
        {msg && <p className="rounded-sm bg-brand-light p-2 text-sm text-brand-dark">{msg}</p>}

        <Field label="Description">
          <textarea
            className="input"
            rows={3}
            maxLength={2000}
            value={form.description}
            onChange={set('description')}
          />
        </Field>

        <Field label="Contact number" error={fieldErrors.contactPhone}>
          <input className="input" value={form.contactPhone} onChange={set('contactPhone')} />
        </Field>

        <div className="border-t pt-3">
          <h3 className="section-title">Portfolio</h3>
          {fieldErrors.portfolio && <p className="mb-2 alert-critical">{fieldErrors.portfolio}</p>}
          {portfolio.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {portfolio.map((url) => (
                <div key={url} className="relative">
                  <img
                    src={url}
                    alt=""
                    className="h-20 w-28 rounded-sm object-cover"
                    loading="lazy"
                  />
                  <button
                    type="button"
                    className="absolute right-1 top-1 rounded-sm bg-surface/90 px-1.5 text-xs text-gray-700"
                    onClick={() => setPortfolio((p) => p.filter((u) => u !== url))}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          <PhotoUploader
            kind="photo"
            label="Upload photos"
            onUploaded={(url: string) => setPortfolio((p) => [...p, url])}
          />
        </div>

        <div className="flex gap-2">
          <button className="btn">Save changes</button>
          <button type="button" className="btn-outline" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="card space-y-3" noValidate>
      <h2 className="section-title">
        {current ? 'Edit your listing' : 'Create your listing'}
      </h2>
      {msg && <p className="rounded-sm bg-brand-light p-2 text-sm text-brand-dark">{msg}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Business name" error={fieldErrors.name}>
          <input className="input" value={form.name} onChange={set('name')} />
        </Field>
        <Field label="Category" error={fieldErrors.category}>
          <select className="input" value={form.category} onChange={set('category')}>
            <option value="">Select category</option>
            {VENDOR_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
        {form.category === 'other' && (
          <Field label="Specify category" error={fieldErrors.otherCategory}>
            <input
              className="input"
              placeholder="Mehendi artist"
              value={form.otherCategory}
              onChange={set('otherCategory')}
            />
          </Field>
        )}
        <Field label="City" error={fieldErrors.city}>
          <input className="input" value={form.city} onChange={set('city')} />
        </Field>
      </div>

      <Field label="Description">
        <textarea
          className="input"
          rows={3}
          maxLength={2000}
          value={form.description}
          onChange={set('description')}
        />
      </Field>

      {/*
        Pricing used to be asked for here as a free-text "starting at", and it
        is asked for properly under Services: an Offering carries a pricing
        model, is what the marketplace reads, and is what a quotation is built
        from. Two answers to one question meant a vendor could not tell which
        one a buyer saw.
      */}
      <div className="border-t pt-3">
        <h3 className="section-title">Portfolio</h3>
        <p className="mb-2 text-sm text-gray-600">
          At least one photo is required (EZ1-I152). Clients rarely book from a listing with none.
        </p>
        {fieldErrors.portfolio && <p className="mb-2 alert-critical">{fieldErrors.portfolio}</p>}
        {portfolio.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {portfolio.map((url) => (
              <div key={url} className="relative">
                <img src={url} alt="" className="h-20 w-28 rounded-sm object-cover" loading="lazy" />
                <button
                  type="button"
                  className="absolute right-1 top-1 rounded-sm bg-surface/90 px-1.5 text-xs text-gray-700"
                  onClick={() => setPortfolio((p) => p.filter((u) => u !== url))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        {/*
          From the device, not from a URL.

          This asked for a link, which a vendor photographing their own venue
          on a phone does not have — and the ones that were pasted showed as
          broken images, because a pasted link is whatever the person pasted.
          The uploader stores the file and hands back a URL the platform
          serves, so the picture that appears is the picture that was chosen.
        */}
        <PhotoUploader
          kind="photo"
          label="Upload photos"
          onUploaded={(url: string) => setPortfolio((p) => [...p, url])}
        />
      </div>

      {/*
        The papers the officer asks to see.

        The column has been on the vendor table since it was written and no
        screen ever offered it, so a visit had nothing to check against. PDFs
        as well as photographs: a GST certificate is rarely a picture.
      */}
      <div className="border-t pt-3">
        <h3 className="section-title">Compliance documents</h3>
        <p className="mb-2 text-sm text-gray-600">
          At least one is required (EZ1-I152). Your PAN document is what the officer checks first.
          GST and any trade licence are useful if you have them. PDF, JPG or PNG.
        </p>
        {fieldErrors.complianceDocuments && (
          <p className="mb-2 alert-critical">{fieldErrors.complianceDocuments}</p>
        )}
        {documents.length > 0 && (
          <ul className="mb-2 divide-y divide-gray-200 rounded-sm border border-gray-200">
            {documents.map((url) => (
              <li key={url} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <a
                  className="min-w-0 flex-1 truncate text-brand-strong"
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {/* The stored name, not the whole URL: a media path is not
                      something anybody reads. */}
                  {decodeURIComponent(url.split('/').pop() ?? 'Document')}
                </a>
                <button
                  type="button"
                  className="btn-ghost btn-sm text-critical-fg"
                  onClick={() => setDocuments((d) => d.filter((u) => u !== url))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <PhotoUploader
          kind="attachment"
          label="Upload a document"
          onUploaded={(url: string) => setDocuments((d) => [...d, url])}
        />
      </div>

      <div className="border-t pt-3">
        <h3 className="section-title">Registration</h3>
        <p className="mb-2 text-sm text-gray-600">
          You invoice real money against real events, so we hold the details that answer for that.
          The registered address is where the verification officer visits.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="GST number" error={fieldErrors.gstNumber}>
            <input
              className="input"
              placeholder="29ABCDE1234F1Z5"
              maxLength={15}
              value={form.gstNumber}
              onChange={(e) => setForm((f) => ({ ...f, gstNumber: e.target.value.toUpperCase() }))}
            />
          </Field>
          <Field label="PAN" error={fieldErrors.panNumber}>
            <input
              className="input"
              placeholder="ABCDE1234F"
              maxLength={10}
              value={form.panNumber}
              onChange={(e) => setForm((f) => ({ ...f, panNumber: e.target.value.toUpperCase() }))}
            />
          </Field>
          <Field label="Registration number">
            <input
              className="input"
              value={form.registrationNumber}
              onChange={set('registrationNumber')}
            />
          </Field>
          <Field label="Trading since">
            {/* A date, not a year (EZ1-I21) — the same question the agency form
                answers, so families can see how long the business has run.
                Today or earlier only; a future trading-since date is not a real
                one (EZ1-I96). The API enforces this too. */}
            <input
              className="input"
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={form.tradingSince}
              onChange={set('tradingSince')}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Registered address" error={fieldErrors.registeredAddress}>
              <input
                className="input"
                value={form.registeredAddress}
                onChange={set('registeredAddress')}
              />
            </Field>
          </div>
          <Field label="Contact number" error={fieldErrors.contactPhone}>
            <input className="input" value={form.contactPhone} onChange={set('contactPhone')} />
          </Field>
        </div>
      </div>

      <div className="flex gap-2">
        <button className="btn">
          {onSaved ? 'Save & Continue' : current ? 'Save changes' : 'Create listing'}
        </button>
        {current && (
          <button type="button" className="btn-outline" onClick={() => setEditing(false)}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="text-gray-800">{children}</dd>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

/**
 * A verified listing's legal details are locked, so a genuine change to one goes
 * through the same correction/reverification path an officer uses (EZ1-I207).
 *
 * The vendor has no endpoint to reopen their own listing — and shouldn't: the
 * point of verification is that they cannot quietly rewrite what was checked. So
 * this raises a `vendor` support case (the one channel they hold, CASE_RAISE)
 * describing the change; the team then reopens the listing for editing through
 * the existing unlock/correction flow.
 */
function RequestChange({ vendorId }: { vendorId: string }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      await api.post('/verification/cases', {
        subjectType: 'vendor',
        subjectId: vendorId,
        title: 'Change request: verified business details',
        description: detail.trim(),
      });
      setMsg('Sent. Our team will review it and reopen the listing if the change checks out.');
      setDetail('');
      setOpen(false);
    } catch (err) {
      setMsg(apiMessage(err, 'That could not be sent.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600">
          PAN, GST, registration and the other verified details are locked. Need one changed?
        </p>
        {!open && (
          <button type="button" className="btn-outline" onClick={() => setOpen(true)}>
            Request a change
          </button>
        )}
      </div>
      {msg && <p className="mt-2 rounded-sm bg-brand-light p-2 text-sm text-brand-dark">{msg}</p>}
      {open && (
        <form onSubmit={submit} className="mt-2 space-y-2">
          <textarea
            className="input"
            rows={3}
            minLength={10}
            maxLength={2000}
            placeholder="Which detail needs changing, what it should be, and why."
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
          />
          <div className="flex gap-2">
            <button className="btn" disabled={busy || detail.trim().length < 10}>
              {busy ? 'Sending…' : 'Send request'}
            </button>
            <button
              type="button"
              className="btn-outline"
              onClick={() => {
                setOpen(false);
                setDetail('');
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

interface PlannerPackage {
  name: string;
  price: number;
  includes?: string[];
}

interface PlannerListing {
  agencyName?: string;
  city?: string;
  bio?: string;
  yearsExperience?: number;
  contactPerson?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  address?: string | null;
  state?: string | null;
  pincode?: string | null;
  website?: string | null;
  isApproved?: boolean;
  portfolio?: string[];
  packages?: PlannerPackage[];
}

/**
 * The planning agency, which could not be saved at all.
 *
 * Two faults, and the second hid the first.
 *
 * `GET /wedding-planners/me` answers with the whole row — id, ownerUserId,
 * isApproved, ratings, timestamps — and this form spread all of it into its
 * state and posted it straight back. The API refuses unknown fields rather
 * than quietly dropping them, so every save returned 400 and the planner was
 * blocked at the first step of onboarding with nothing to act on. The form
 * also never prefilled, for the same reason from the other direction.
 *
 * And the catch discarded the error. The server said exactly which property it
 * would not accept; the screen replaced that with "Could not save the listing"
 * and left the person to guess. Reading the four fields the form owns, and
 * sending only those, fixes the save; showing what the server said is what
 * makes the next failure diagnosable.
 */
const EMPTY_PLANNER = {
  agencyName: '',
  city: '',
  bio: '',
  yearsExperience: 0,
  contactPerson: '',
  contactPhone: '',
  contactEmail: '',
  address: '',
  state: '',
  pincode: '',
  website: '',
};

function PlannerListingForm({ existing }: { existing?: PlannerListing }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY_PLANNER);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [portfolio, setPortfolio] = useState<string[]>([]);
  const [packages, setPackages] = useState<PlannerPackage[]>([]);
  const [pkgName, setPkgName] = useState('');
  const [pkgPrice, setPkgPrice] = useState('');
  const [msg, setMsg] = useState('');

  // A rejected planner is locked out of re-verification (EZ1-I66, EZ1-I72): the
  // listing badge shows Rejected, and the save is disabled because the server
  // refuses to re-queue a rejected account.
  const { data: verification } = useQuery({
    queryKey: ['my-verification'],
    queryFn: async () =>
      (await api.get('/verification/me')).data as {
        status: string | null;
        remarks: string | null;
      },
    retry: false,
  });
  const rejected = verification?.status === 'rejected';
  // An approved listing is read-only (EZ1-I138): once couples can see it, the
  // agency name, pricing and the rest cannot be quietly rewritten under them.
  const approved = existing?.isApproved ?? false;

  useEffect(() => {
    if (!existing) return;
    setForm({
      agencyName: existing.agencyName ?? '',
      city: existing.city ?? '',
      bio: existing.bio ?? '',
      yearsExperience: existing.yearsExperience ?? 0,
      contactPerson: existing.contactPerson ?? '',
      contactPhone: existing.contactPhone ?? '',
      contactEmail: existing.contactEmail ?? '',
      address: existing.address ?? '',
      state: existing.state ?? '',
      pincode: existing.pincode ?? '',
      website: existing.website ?? '',
    });
    setPortfolio(existing.portfolio ?? []);
    setPackages(existing.packages ?? []);
  }, [existing]);

  // Field-level validation before the profile can be saved (EZ1-I69). Nothing
  // entered is lost on a failure: the form keeps its values and only marks the
  // fields that are wrong.
  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    // Required fields the business cannot go live without (EZ1-I106).
    if (!form.agencyName.trim()) errors.agencyName = 'A business name is required';
    if (!form.city.trim()) errors.city = 'A city is required';
    if (!form.contactPerson.trim()) errors.contactPerson = 'A contact person is required';
    if (!form.contactPhone.trim()) {
      errors.contactPhone = 'A contact number is required';
    } else if (!/^(\+91)?[6-9]\d{9}$/.test(form.contactPhone.replace(/\s|-/g, ''))) {
      errors.contactPhone = 'Enter a 10-digit Indian mobile number';
    }
    if (form.pincode && !/^[1-9]\d{5}$/.test(form.pincode.trim())) {
      errors.pincode = 'Enter a valid 6-digit pincode';
    }
    if (
      form.yearsExperience !== undefined &&
      (Number(form.yearsExperience) < 0 || Number(form.yearsExperience) > 80)
    ) {
      errors.yearsExperience = 'Enter a realistic number of years';
    }
    if (form.website && !/^https?:\/\/[^\s.]+\.[^\s]{2,}$/.test(form.website.trim())) {
      errors.website = 'Enter a full web address, starting http:// or https://';
    }
    return errors;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setMsg('Fix the highlighted fields before saving.');
      return;
    }
    try {
      await api.put('/wedding-planners/me', {
        agencyName: form.agencyName.trim(),
        // Blanks are dropped rather than sent as empty strings, which fail the
        // length checks on the optional fields.
        ...(form.city.trim() ? { city: form.city.trim() } : {}),
        ...(form.bio.trim() ? { bio: form.bio.trim() } : {}),
        yearsExperience: Number(form.yearsExperience) || 0,
        ...(form.contactPerson.trim() ? { contactPerson: form.contactPerson.trim() } : {}),
        ...(form.contactPhone.trim() ? { contactPhone: form.contactPhone.trim() } : {}),
        ...(form.contactEmail.trim() ? { contactEmail: form.contactEmail.trim() } : {}),
        ...(form.address.trim() ? { address: form.address.trim() } : {}),
        ...(form.state.trim() ? { state: form.state.trim() } : {}),
        ...(form.pincode.trim() ? { pincode: form.pincode.trim() } : {}),
        ...(form.website.trim() ? { website: form.website.trim() } : {}),
        // Portfolio and packages are the couple's evidence and the couple's
        // prices — the backend already stored both, the form never sent them
        // (EZ1-I24). Always sent, including empty, so removing the last one
        // reaches the server.
        portfolio,
        packages: packages.map((p) => ({ name: p.name, price: p.price })),
      });
      /*
       * What actually happens next, which depends on where the listing stands.
       *
       * This said "an administrator will review it" unconditionally, including
       * to planners who had been approved weeks earlier — so the one screen
       * that should have told them they were live was the screen insisting
       * they were not. The server has always returned isApproved; nothing read
       * it.
       */
      setMsg(
        existing?.isApproved
          ? 'Saved. Your listing is approved, so the change is live for couples now.'
          : 'Saved. An administrator will review it before it appears in search.',
      );
      qc.invalidateQueries({ queryKey: ['my-listing'] });
      // Keep the dashboard greeting and profile-completion in step (EZ1-I118).
      qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      setMsg(apiMessage(err, 'Could not save the listing.'));
    }
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form onSubmit={submit} className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title">Your planning agency</h2>
        {/*
          Where the listing stands, always on screen.

          A save message is transient and was the only thing ever saying
          anything about approval, so a planner who reloaded the page had no
          way to tell whether they were live. This reads the server's own
          answer, so the page and the search results cannot disagree.
        */}
        {existing && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              existing.isApproved
                ? 'bg-emerald-50 text-emerald-800'
                : rejected
                  ? 'bg-red-50 text-red-800'
                  : 'bg-amber-50 text-amber-800'
            }`}
          >
            {existing.isApproved
              ? 'Approved — visible to couples'
              : rejected
                ? 'Rejected'
                : 'Awaiting approval'}
          </span>
        )}
      </div>
      {rejected && (
        <p className="alert-critical">
          Your verification was rejected, so this listing stays out of search and cannot be
          submitted again. {verification?.remarks ? `Reason: ${verification.remarks}. ` : ''}An
          administrator must review the decision before it can return to the queue.
        </p>
      )}
      {msg && <p className="rounded-sm bg-brand-light p-2 text-sm text-brand-dark">{msg}</p>}
      {approved && (
        <p className="rounded-sm bg-emerald-50 p-2 text-sm text-emerald-800">
          This listing is approved and live for couples, so its details are read-only. To change
          anything, contact Support and an administrator will reopen it for editing.
        </p>
      )}
      {/* disabled disables every control inside, so an approved listing cannot be
          edited or re-saved (EZ1-I138). */}
      <fieldset disabled={approved} className="space-y-3 border-0 p-0">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Agency name" error={fieldErrors.agencyName}>
          <input className="input" value={form.agencyName} onChange={set('agencyName')} required />
        </Field>
        {/* City as a dropdown (EZ1-I127), with a free-text escape for anywhere
            not on the list. */}
        <ChoiceField
          label="Base city"
          value={form.city}
          onChange={(v) => setForm((f) => ({ ...f, city: v }))}
          options={CITIES}
          required
        />
        {fieldErrors.city && <p className="-mt-2 text-xs text-red-600">{fieldErrors.city}</p>}
        <Field label="Years of experience" error={fieldErrors.yearsExperience}>
          <input
            className="input"
            type="number"
            min={0}
            max={80}
            value={form.yearsExperience}
            onChange={set('yearsExperience')}
          />
        </Field>
      </div>

      {/* Contact and location, with field-level validation (EZ1-I69). */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Contact person" error={fieldErrors.contactPerson}>
          <input className="input" value={form.contactPerson} onChange={set('contactPerson')} required />
        </Field>
        <Field label="Contact mobile" error={fieldErrors.contactPhone}>
          <input
            className="input"
            placeholder="9876543210"
            value={form.contactPhone}
            onChange={set('contactPhone')}
          />
        </Field>
        {/* Contact email removed from the planner listing form (EZ1-I127): the
            business is reached through the platform, not a second inbox. */}
        {/* State as a dropdown (EZ1-I127). */}
        <ChoiceField
          label="State"
          value={form.state}
          onChange={(v) => setForm((f) => ({ ...f, state: v }))}
          options={STATES}
        />
        <Field label="Pincode" error={fieldErrors.pincode}>
          <input
            className="input"
            inputMode="numeric"
            maxLength={6}
            value={form.pincode}
            onChange={set('pincode')}
          />
        </Field>
        <Field label="Website / social" error={fieldErrors.website}>
          <input
            className="input"
            placeholder="https://…"
            value={form.website}
            onChange={set('website')}
          />
        </Field>
      </div>
      <div>
        <label className="label">Business address</label>
        <textarea
          className="input"
          rows={2}
          maxLength={500}
          value={form.address}
          onChange={set('address')}
        />
      </div>
      <div>
        <label className="label">About your agency</label>
        <textarea className="input" rows={3} maxLength={2000} value={form.bio} onChange={set('bio')} />
      </div>

      {/* Portfolio — uploaded from the device, the same as the vendor listing. */}
      <div className="border-t pt-3">
        <label className="label">Portfolio</label>
        <p className="mb-2 text-sm text-gray-600">
          Weddings you have run. A couple books the planner whose work they can see.
        </p>
        {portfolio.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {portfolio.map((url) => (
              <div key={url} className="relative">
                <img src={url} alt="" className="h-20 w-28 rounded-sm object-cover" loading="lazy" />
                <button
                  type="button"
                  className="absolute right-1 top-1 rounded-sm bg-surface/90 px-1.5 text-xs text-gray-700"
                  onClick={() => setPortfolio((p) => p.filter((u) => u !== url))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <PhotoUploader
          kind="photo"
          label="Upload photos"
          onUploaded={(url) => setPortfolio((p) => [...p, url])}
        />
      </div>

      {/* Packages & pricing — the offerings a couple compares planners on. */}
      <div className="border-t pt-3">
        <label className="label">Packages &amp; pricing</label>
        {packages.length > 0 && (
          <ul className="mb-2 divide-y divide-gray-200 rounded-sm border border-gray-200">
            {packages.map((p, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">{p.name}</span>
                <span className="flex items-center gap-3">
                  <span className="text-gray-600">₹{Number(p.price).toLocaleString('en-IN')}</span>
                  <button
                    type="button"
                    className="text-critical-fg"
                    onClick={() => setPackages((ps) => ps.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <input
            className="input flex-1"
            placeholder="Package name (e.g. Full planning)"
            value={pkgName}
            onChange={(e) => setPkgName(e.target.value)}
          />
          <input
            className="input w-32"
            type="number"
            min={0}
            placeholder="Price ₹"
            value={pkgPrice}
            onChange={(e) => setPkgPrice(e.target.value)}
          />
          <button
            type="button"
            className="btn-outline"
            disabled={!pkgName.trim() || !pkgPrice}
            onClick={() => {
              setPackages((ps) => [...ps, { name: pkgName.trim(), price: Number(pkgPrice) }]);
              setPkgName('');
              setPkgPrice('');
            }}
          >
            Add package
          </button>
        </div>
      </div>

      <button className="btn" disabled={rejected}>
        Save listing
      </button>
      </fieldset>
    </form>
  );
}
