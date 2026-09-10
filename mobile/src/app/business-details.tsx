import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import { CATEGORY_LABEL } from '@/lib/business-status';
import { todayIso } from '@/components/calendar';
import { useActiveListing } from '@/lib/vendor-listing';
import { GSTIN_PATTERN, PAN_PATTERN, VENDOR_CATEGORIES } from '@/shared/permissions';
import { Divider, InfoNote } from '@/components/chrome';
import { DateField, SelectField, Textarea } from '@/components/form';
import { useCompletion, useRefreshBusiness } from '@/components/business/completion';
import { DocumentList, MediaStrip, PhotoPicker } from '@/components/uploader';
import {
  Alert,
  Body,
  Button,
  Caption,
  Card,
  Field,
  Loading,
  PageSubtitle,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { useBusinesses } from '@/store/business';
import { space } from '@/theme';

/**
 * Business Details — step one of My Business.
 *
 * The web client's VendorListingForm, field for field and message for message.
 * Two things about it are worth keeping in mind while reading:
 *
 * The validation is deliberately duplicated from that file rather than shared,
 * because the API validates the same things again and this exists only to say
 * *which* field is wrong before a round trip. The wording matters more than the
 * logic — "A PAN is required — it is what payouts are made against" tells a
 * vendor why, and "invalid" does not.
 *
 * And whether the form may be submitted at all is the server's answer, not this
 * screen's: `completion().rules` decides whether the identity fields are open,
 * whether only the presentational ones are, or whether the whole thing is
 * locked because an officer has already been sent to check it.
 */

const EMPTY = {
  name: '',
  // No category is pre-selected — the vendor must choose one rather than have
  // "Venue" default in on their behalf.
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

type Form = typeof EMPTY;
type Errors = Partial<Record<keyof Form | 'portfolio' | 'complianceDocuments', string>>;

const MOBILE = /^(\+91)?[6-9]\d{9}$/;

export default function BusinessDetails() {
  const router = useRouter();
  const qc = useQueryClient();
  const refresh = useRefreshBusiness();
  const { activeId } = useBusinesses();
  const { listing, isPending } = useActiveListing(activeId);
  const { data: completion } = useCompletion(activeId);

  const [form, setForm] = useState<Form>(EMPTY);
  const [portfolio, setPortfolio] = useState<string[]>([]);
  const [documents, setDocuments] = useState<string[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /*
   * Whether this listing may still be edited, asked of the server.
   *
   * The API already refuses an edit once a listing is submitted — a vendor who
   * changes their GST number after an officer has been sent to check it has
   * verified nothing — and reading the answer rather than re-deriving it is
   * what keeps the form from offering a save the API will refuse.
   */
  const locked = completion ? !completion.rules.editIdentity : false;
  const presentationalOnly = locked && (completion?.rules.editPresentational ?? false);
  const readOnly = locked && !presentationalOnly;

  useEffect(() => {
    if (!listing) return;
    setForm({
      name: listing.name ?? '',
      category: listing.category ?? '',
      otherCategory: listing.otherCategory ?? '',
      city: listing.city ?? '',
      description: listing.description ?? '',
      gstNumber: listing.gstNumber ?? '',
      panNumber: listing.panNumber ?? '',
      registrationNumber: listing.registrationNumber ?? '',
      tradingSince: listing.tradingSince ? listing.tradingSince.slice(0, 10) : '',
      registeredAddress: listing.registeredAddress ?? '',
      contactPhone: listing.contactPhone ?? '',
    });
    setPortfolio(listing.portfolio ?? []);
    setDocuments(listing.complianceDocuments ?? []);
  }, [listing]);

  const set = (key: keyof Form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  /** Field-level, and specific about what is wrong rather than "invalid". */
  function validate(): Errors {
    const found: Errors = {};
    if (!form.name.trim()) found.name = 'Your business needs a name';
    // Category, city, registered address, a portfolio image and a compliance
    // document are all mandatory to submit a listing for verification — an
    // officer cannot verify a business that has named none of them.
    if (!form.category) found.category = 'Choose a category';
    if (form.category === 'other' && !form.otherCategory.trim()) {
      found.otherCategory = 'Say what you do, so clients can find you';
    }
    if (!form.city.trim()) found.city = 'A city is required';
    if (!form.registeredAddress.trim()) {
      found.registeredAddress = 'A registered address is required — it is where the officer visits';
    }
    if (portfolio.length === 0) found.portfolio = 'Add at least one portfolio photo';
    if (documents.length === 0) {
      found.complianceDocuments = 'Upload at least one compliance document';
    }
    if (form.gstNumber && !GSTIN_PATTERN.test(form.gstNumber.toUpperCase())) {
      found.gstNumber = 'A GSTIN is 15 characters, like 29ABCDE1234F1Z5';
    }
    /*
     * PAN is required; GST and the registration number are not.
     *
     * The platform invoices against the PAN and cannot pay anybody out without
     * one, so a listing that reaches verification without it is a listing that
     * cannot be paid. Plenty of legitimate small businesses have no GST
     * registration and no company number, and refusing those would turn away
     * exactly the vendors this marketplace is for.
     */
    if (!form.panNumber.trim()) {
      found.panNumber = 'A PAN is required — it is what payouts are made against';
    } else if (!PAN_PATTERN.test(form.panNumber.toUpperCase())) {
      found.panNumber = 'A PAN is 10 characters, like ABCDE1234F';
    }
    if (!form.contactPhone.trim()) {
      found.contactPhone = 'A contact mobile number is required';
    } else if (!MOBILE.test(form.contactPhone.replace(/\s|-/g, ''))) {
      found.contactPhone = 'Enter a 10-digit Indian mobile number';
    }
    return found;
  }

  /** The lighter check for a verified/live listing: only what is on screen. */
  function validatePresentational(): Errors {
    const found: Errors = {};
    if (portfolio.length === 0) found.portfolio = 'Add at least one portfolio photo';
    if (!form.contactPhone.trim()) {
      found.contactPhone = 'A contact mobile number is required';
    } else if (!MOBILE.test(form.contactPhone.replace(/\s|-/g, ''))) {
      found.contactPhone = 'Enter a 10-digit Indian mobile number';
    }
    return found;
  }

  async function save() {
    setError('');
    setNotice('');
    const found = presentationalOnly ? validatePresentational() : validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      // A verified/live listing may only change the presentational fields, so
      // the payload carries just those — the legal fields are not sent, not
      // merely disabled.
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
          // An empty string is not "not provided" — sending one fails the
          // format checks on GST and PAN, so blanks are dropped instead.
          if (form[key]) payload[key] = form[key];
        }
      }

      const created = !listing;
      if (listing) await api.put(`/vendors/${listing.id}`, payload);
      else await api.post('/vendors', payload);

      refresh();
      void qc.invalidateQueries({ queryKey: ['businesses'] });

      if (created) {
        // A brand-new listing has nothing to sell yet, so the next step is the
        // catalog — the same place the web wizard's "Save & Continue" lands.
        router.replace('/business-services');
        return;
      }
      setNotice(
        presentationalOnly
          ? 'Saved. Your listing stays live and the change is visible to couples now.'
          : 'Saved. A verification officer visits the registered address before the listing goes live.',
      );
    } catch (err) {
      setError(apiMessage(err, 'Could not save the listing.'));
    } finally {
      setBusy(false);
    }
  }

  if (isPending) {
    return (
      <Screen>
        <Loading rows={4} />
      </Screen>
    );
  }

  if (readOnly) {
    return (
      <Screen>
        <View style={{ gap: space(1) }}>
          <PageSubtitle>{completion?.rules.note}</PageSubtitle>
        </View>
        <Card>
          <SectionTitle>Locked while it is verified</SectionTitle>
          <Body tone="muted">
            An officer has been sent to check these details, so they cannot change until the visit
            is decided. If it is sent back for changes, this form opens again.
          </Body>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ gap: space(1) }}>
        {/* No title: the native header carries it. Whether this is a first
            listing or an edit is said by the subtitle and by the save button. */}
        {presentationalOnly ? (
          <PageSubtitle>
            Your listing is verified. About, contact number and photos are yours to change and go
            live straight away. The verified details — name, category, PAN, GST, registration and
            address — are locked; use “Request a change” for those.
          </PageSubtitle>
        ) : (
          <PageSubtitle>
            Who you are, where you trade, and the papers behind it. The registered address is where
            the verification officer visits.
          </PageSubtitle>
        )}
      </View>

      {notice ? <Alert tone="positive">{notice}</Alert> : null}
      {error ? <Alert tone="critical">{error}</Alert> : null}

      {!presentationalOnly && (
        <Card>
          <SectionTitle>The business</SectionTitle>
          <Field
            label="Business name"
            value={form.name}
            onChangeText={set('name')}
            error={errors.name}
            autoCapitalize="words"
          />
          <SelectField
            label="Category"
            value={form.category}
            onChange={set('category')}
            error={errors.category}
            placeholder="Select category"
            options={VENDOR_CATEGORIES.map((c) => ({
              value: c,
              label: CATEGORY_LABEL[c] ?? c,
            }))}
          />
          {form.category === 'other' && (
            <Field
              label="Specify category"
              placeholder="Mehendi artist"
              value={form.otherCategory}
              onChangeText={set('otherCategory')}
              error={errors.otherCategory}
            />
          )}
          <Field
            label="City"
            value={form.city}
            onChangeText={set('city')}
            error={errors.city}
            autoCapitalize="words"
          />
        </Card>
      )}

      <Card>
        <SectionTitle>About</SectionTitle>
        <Textarea
          label="Description"
          value={form.description}
          onChange={set('description')}
          rows={4}
          maxLength={2000}
        />
        {presentationalOnly && (
          <Field
            label="Contact number"
            value={form.contactPhone}
            onChangeText={set('contactPhone')}
            error={errors.contactPhone}
            keyboardType="phone-pad"
          />
        )}
      </Card>

      {/*
        From the device, not from a URL.

        The web form asked for a link, which a vendor photographing their own
        venue on a phone does not have — and the ones that were pasted showed
        as broken images. Here the camera is one press away, which is the whole
        argument for this app existing.
      */}
      <Card>
        <SectionTitle>Portfolio</SectionTitle>
        <Body tone="muted">
          At least one photo is required. Clients rarely book from a listing with none.
        </Body>
        {errors.portfolio ? <Alert tone="critical">{errors.portfolio}</Alert> : null}
        <MediaStrip urls={portfolio} onRemove={(url) => setPortfolio((p) => p.filter((u) => u !== url))} />
        <PhotoPicker
          label="Add photos"
          onUploaded={(url) => setPortfolio((p) => [...p, url])}
        />
      </Card>

      {!presentationalOnly && (
        <>
          {/* The papers the officer asks to see. */}
          <Card>
            <SectionTitle>Compliance documents</SectionTitle>
            <Body tone="muted">
              At least one is required. Your PAN document is what the officer checks first. GST and
              any trade licence are useful if you have them.
            </Body>
            {errors.complianceDocuments ? (
              <Alert tone="critical">{errors.complianceDocuments}</Alert>
            ) : null}
            <DocumentList
              urls={documents}
              onRemove={(url) => setDocuments((d) => d.filter((u) => u !== url))}
            />
            <PhotoPicker
              label="Add a document"
              kind="attachment"
              onUploaded={(url) => setDocuments((d) => [...d, url])}
            />
          </Card>

          <Card>
            <SectionTitle>Registration</SectionTitle>
            <Body tone="muted">
              You invoice real money against real events, so we hold the details that answer for
              that. The registered address is where the verification officer visits.
            </Body>
            <Divider />
            <Field
              label="GST number"
              placeholder="29ABCDE1234F1Z5"
              maxLength={15}
              autoCapitalize="characters"
              value={form.gstNumber}
              onChangeText={(v) => set('gstNumber')(v.toUpperCase())}
              error={errors.gstNumber}
            />
            <Field
              label="PAN"
              placeholder="ABCDE1234F"
              maxLength={10}
              autoCapitalize="characters"
              value={form.panNumber}
              onChangeText={(v) => set('panNumber')(v.toUpperCase())}
              error={errors.panNumber}
            />
            <Field
              label="Registration number"
              value={form.registrationNumber}
              onChangeText={set('registrationNumber')}
              autoCapitalize="characters"
            />
            {/* A date, not a year — the same question the agency form answers,
                so families can see how long the business has run. Today or
                earlier only; a future trading-since date is not a real one, and
                the API enforces this too. */}
            <DateField
              label="Trading since"
              value={form.tradingSince}
              onChange={set('tradingSince')}
              to={todayIso()}
              hint="Today or earlier."
            />
            <Textarea
              label="Registered address"
              value={form.registeredAddress}
              onChange={set('registeredAddress')}
              rows={3}
              maxLength={500}
              error={errors.registeredAddress}
            />
            <Field
              label="Contact number"
              value={form.contactPhone}
              onChangeText={set('contactPhone')}
              error={errors.contactPhone}
              keyboardType="phone-pad"
            />
          </Card>
        </>
      )}

      {!listing ? (
        <InfoNote>
          Saving creates the listing and takes you on to Catalog & Services, where you say what you
          sell and what it costs.
        </InfoNote>
      ) : null}

      <Button
        label={listing ? 'Save changes' : 'Save and continue'}
        busy={busy}
        onPress={() => void save()}
      />
      {listing ? (
        <Caption tone="faint">
          Nothing entered is lost on a failure — only the fields that are wrong are marked.
        </Caption>
      ) : null}
    </Screen>
  );
}
