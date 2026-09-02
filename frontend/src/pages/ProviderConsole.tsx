import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import BusinessSetup, { useCompletion } from '../components/BusinessSetup';
import GetStarted from '../components/GetStarted';
import { useAuth } from '../store/auth';
import { useBusinesses } from '../store/business';
import VendorServices from '../components/VendorServices';
import ReviewsPanel from '../components/ReviewsPanel';
import PhotoUploader from '../components/PhotoUploader';
import {
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
  const { activeId, active } = useBusinesses();
  const vendorId: string | undefined = isVendor ? (activeId ?? undefined) : undefined;
  const current = isVendor
    ? ((listing as VendorListing[] | undefined) ?? []).find((l) => l.id === vendorId)
    : undefined;
  // A vendor has many listings and a planner has exactly one, so the planner
  // branch reads the object rather than indexing into it. `listing?.[0]` on an
  // object is always undefined, which is why a planner's approval state never
  // showed whatever the server said.
  const approved: boolean | undefined = isVendor ? active?.isApproved : listing?.isApproved;

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
      {vendorId ? <BusinessSetup businessId={vendorId} /> : <GetStarted />}

      {isVendor ? (
        <VendorListingForm existing={current ? [current] : []} />
      ) : (
        <PlannerListingForm existing={listing} />
      )}

      {vendorId && (
        <div className="card">
          <h2 className="section-title">Verification</h2>
          <p className="mt-1 text-sm text-gray-600">
            {approved
              ? 'Approved. Your listing appears in search and can take bookings.'
              : 'A verification officer visits before your listing appears in search. You can keep ' +
                'setting it up in the meantime, nothing is lost while you wait.'}
          </p>
          <p className="mt-2">
            <span
              className={`rounded-full px-2 py-1 text-xs ${
                approved ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
              }`}
            >
              {current?.status
                ? current.status.replace(/_/g, ' ')
                : approved
                  ? 'Approved'
                  : 'Awaiting verification'}
            </span>
          </p>

          {/*
            The exact words the officer wrote. A listing sent back with "there
            was a problem" is a refusal with no instruction in it — the vendor
            cannot fix what nobody has named, and the next visit finds the same
            thing. It is read from the owner-only route, so it is not something
            a competitor can look up.
          */}
          {current?.decisionReason && (
            <div className="mt-3 rounded-sm border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                What needs fixing
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-amber-900">
                {current.decisionReason}
              </p>
            </div>
          )}
        </div>
      )}

      {vendorId && (
        <PayoutAccount vendorId={vendorId} current={current?.payoutAccountId ?? null} />
      )}

      {vendorId && <VendorServices vendorId={vendorId} />}

      {/*
        The vendor's own reviews, with the reviewers left out — the same view a
        buyer gets, and deliberately so. A vendor who could work out which
        customer left three stars could take it up with them, and the prospect
        of that conversation is what stops the next honest review being written.
      */}
      {vendorId && (
        <div className="card space-y-3">
          <div>
            <h2 className="section-title">What people said</h2>
            <p className="text-sm text-gray-600">
              Written after a completed booking. You cannot edit or remove these; if one breaks the
              rules, raise it on Support and an administrator looks at it.
            </p>
          </div>
          <ReviewsPanel vendorId={vendorId} />
        </div>
      )}

      {/*
        Availability and Bookings are their own modules. Duplicating them here
        was the reported defect: the same list in two places drifts, and the
        vendor stops trusting either.
      */}
      {vendorId && (
        <div className="card space-y-2 text-sm text-gray-600">
          <p>
            <Link className="text-brand underline" to="/availability">
              Availability
            </Link>:{' '}
          publish the windows you can take work in, and set how many bookings each one holds.
          </p>
          <p>
            <Link className="text-brand underline" to="/bookings">
              Bookings
            </Link>:{' '}
          new requests, quotations, confirmations, payments and disputes.
          </p>
        </div>
      )}
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
  registeredAddress: string | null;
  contactPhone: string | null;
  portfolio: string[];
  complianceDocuments: string[];
  isApproved: boolean;
  payoutAccountId: string | null;
  /** Where this business is in its life, from draft to live. */
  status: string;
  decisionReason: string | null;
}

const emptyListing = {
  name: '',
  category: 'venue',
  otherCategory: '',
  city: '',
  description: '',
  gstNumber: '',
  panNumber: '',
  registrationNumber: '',
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
function VendorListingForm({ existing }: { existing?: VendorListing[] }) {
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
      category: current.category ?? 'venue',
      otherCategory: current.otherCategory ?? '',
      city: current.city ?? '',
      description: current.description ?? '',
      gstNumber: current.gstNumber ?? '',
      panNumber: current.panNumber ?? '',
      registrationNumber: current.registrationNumber ?? '',
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
    if (form.category === 'other' && !form.otherCategory.trim()) {
      errors.otherCategory = 'Say what you do, so clients can find you';
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
    if (form.contactPhone && !/^(\+91)?[6-9]\d{9}$/.test(form.contactPhone.replace(/\s|-/g, ''))) {
      errors.contactPhone = 'Enter a 10-digit Indian mobile number';
    }
    return errors;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        category: form.category,
        // Portfolio is deliberately always sent, including empty: clearing the
        // last photo has to be able to reach the server.
        portfolio,
        complianceDocuments: documents,
      };
      if (form.category === 'other') payload.otherCategory = form.otherCategory.trim();
      for (const key of [
        'city',
        'description',
        'gstNumber',
        'panNumber',
        'registrationNumber',
        'registeredAddress',
        'contactPhone',
      ] as const) {
        // An empty string is not "not provided" — sending one fails the format
        // checks on GST and PAN, so blanks are dropped instead.
        if (form[key]) payload[key] = form[key];
      }

      if (current) await api.put(`/vendors/${current.id}`, payload);
      else await api.post('/vendors', payload);

      setMsg(
        'Saved. A verification officer visits the registered address before the listing goes live.',
      );
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['my-listing'] });
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
            {locked ? (
              <span
                className="text-xs text-gray-500"
                title={completion?.rules.note}
              >
                Locked while it is verified
              </span>
            ) : (
              <button className="btn-outline" onClick={() => setEditing(true)}>
                Edit
              </button>
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
      </div>
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
        <Field label="Category">
          <select className="input" value={form.category} onChange={set('category')}>
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
        <Field label="City">
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
          Optional. A listing saves perfectly well without photographs, though very few clients
          book from one that has none.
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
          Your PAN document is what the officer checks first. GST and any trade licence are
          useful if you have them. PDF, JPG or PNG.
        </p>
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
          <div className="sm:col-span-2">
            <Field label="Registered address">
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
        <button className="btn">{current ? 'Save changes' : 'Create listing'}</button>
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

interface PlannerListing {
  agencyName?: string;
  city?: string;
  bio?: string;
  yearsExperience?: number;
  isApproved?: boolean;
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
function PlannerListingForm({ existing }: { existing?: PlannerListing }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ agencyName: '', city: '', bio: '', yearsExperience: 0 });
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!existing) return;
    setForm({
      agencyName: existing.agencyName ?? '',
      city: existing.city ?? '',
      bio: existing.bio ?? '',
      yearsExperience: existing.yearsExperience ?? 0,
    });
  }, [existing]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      await api.put('/wedding-planners/me', {
        agencyName: form.agencyName.trim(),
        // Blanks are dropped rather than sent as empty strings, which fail the
        // length checks on the optional fields.
        ...(form.city.trim() ? { city: form.city.trim() } : {}),
        ...(form.bio.trim() ? { bio: form.bio.trim() } : {}),
        yearsExperience: Number(form.yearsExperience) || 0,
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
                : 'bg-amber-50 text-amber-800'
            }`}
          >
            {existing.isApproved ? 'Approved — visible to couples' : 'Awaiting approval'}
          </span>
        )}
      </div>
      {msg && <p className="rounded-sm bg-brand-light p-2 text-sm text-brand-dark">{msg}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Agency name</label>
          <input className="input" value={form.agencyName} onChange={set('agencyName')} required />
        </div>
        <div>
          <label className="label">Base city</label>
          <input className="input" value={form.city} onChange={set('city')} />
        </div>
        <div>
          <label className="label">Years of experience</label>
          <input
            className="input"
            type="number"
            min={0}
            max={80}
            value={form.yearsExperience}
            onChange={set('yearsExperience')}
          />
        </div>
      </div>
      <div>
        <label className="label">About your agency</label>
        <textarea className="input" rows={3} maxLength={2000} value={form.bio} onChange={set('bio')} />
      </div>
      <button className="btn">Save listing</button>
    </form>
  );
}

/**
 * Where escrow pays out to.
 *
 * Its own card rather than a field on the listing form, because it is the one
 * value on a business record that decides where money lands — and burying it
 * among portfolio URLs is how it gets changed by accident.
 *
 * Until it is set, money released from escrow is held as owed rather than
 * transferred. That is said plainly here: a provider whose payment has not
 * arrived should be able to find out why on the screen that caused it.
 */
function PayoutAccount({ vendorId, current }: { vendorId: string; current: string | null }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(current ?? '');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => setValue(current ?? ''), [current]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      await api.put(`/vendors/${vendorId}/payout-account`, { payoutAccountId: value.trim() });
      await qc.invalidateQueries({ queryKey: ['my-listing'] });
      await qc.invalidateQueries({ queryKey: ['earnings'] });
      setEditing(false);
      setNotice(
        value.trim()
          ? 'Saved. Anything already owed to you goes out on the next payout run.'
          : 'Cleared. Payouts will be held until you add an account.',
      );
    } catch (err) {
      setError(apiMessage(err, 'That could not be saved.'));
    }
  }

  return (
    <div className="card space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="section-title">Payouts</h2>
          <p className="text-sm text-gray-600">
            Where money leaves escrow to. Until this is set, what you have earned is held as owed
            rather than paid.
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-1 text-xs ${
            current ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
          }`}
        >
          {current ? 'Ready' : 'Not set up'}
        </span>
      </div>

      {error && <p className="alert-critical">{error}</p>}
      {notice && <p className="rounded-sm bg-emerald-50 p-2 text-sm text-emerald-700">{notice}</p>}

      {!editing ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className={current ? 'font-medium text-gray-900' : 'text-gray-400'}>
            {current ?? 'No payout account'}
          </span>
          <button className="btn-outline" onClick={() => setEditing(true)}>
            {current ? 'Change' : 'Add one'}
          </button>
        </div>
      ) : (
        <form onSubmit={save} className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="text-gray-700">Linked account</span>
            <input
              className="input mt-1"
              placeholder="acc_XXXXXXXXXXXX"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <span className="mt-1 block text-xs text-gray-500">
              From your payment gateway, once your onboarding has cleared. Leave it blank to stop
              payouts.
            </span>
          </label>
          <button className="btn">Save</button>
          <button type="button" className="btn-outline" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
