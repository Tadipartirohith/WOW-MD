import { FormEvent, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { VERIFICATION_LABEL, VerificationStatus } from '../lib/permissions';

interface Agency {
  id: string;
  agencyName: string;
  registrationNumber: string | null;
  contactPhone: string | null;
  city: string | null;
  about: string | null;
  address: string | null;
  startDate: string | null;
  pictures: string[];
  isApproved: boolean;
  rejectionReason: string | null;
}

const empty = {
  agencyName: '',
  registrationNumber: '',
  contactPhone: '',
  city: '',
  address: '',
  startDate: '',
  about: '',
};

/**
 * Agency registration and its approval state.
 *
 * An agent can sign in and browse the moment they register, but building client
 * profiles and sending invitations both mean acting for other real people, so
 * those stay locked until an administrator approves this record.
 */
export default function Agency() {
  const qc = useQueryClient();
  const [form, setForm] = useState(empty);
  const [pictures, setPictures] = useState<string[]>([]);
  const [pictureUrl, setPictureUrl] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const { data: verification } = useQuery({
    queryKey: ['my-verification'],
    queryFn: async () =>
      (await api.get('/verification/me')).data as {
        id: string | null;
        status: VerificationStatus | null;
        remarks: string | null;
        submittedAt: string | null;
      },
    retry: false,
  });

  const { data: billing } = useQuery({
    queryKey: ['agency-billing'],
    queryFn: async () =>
      (await api.get('/agents/billing')).data as {
        charges: {
          id: string;
          type: string;
          amount: string;
          currency: string;
          status: string;
          profileId: string;
        }[];
        totals: Record<string, string>;
      },
    retry: false,
  });

  const { data: agency, isLoading } = useQuery({
    queryKey: ['agency'],
    queryFn: async () => (await api.get('/agents/agency')).data as Agency,
    // A 404 just means "not registered yet", which is a normal first-run state.
    retry: false,
  });

  useEffect(() => {
    if (agency) {
      setForm({
        agencyName: agency.agencyName ?? '',
        registrationNumber: agency.registrationNumber ?? '',
        contactPhone: agency.contactPhone ?? '',
        city: agency.city ?? '',
        address: agency.address ?? '',
        startDate: agency.startDate ?? '',
        about: agency.about ?? '',
      });
      setPictures(agency.pictures ?? []);
    }
  }, [agency]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      const payload: Record<string, unknown> = { agencyName: form.agencyName };
      for (const key of [
        'registrationNumber',
        'contactPhone',
        'city',
        'address',
        'startDate',
        'about',
      ] as const) {
        if (form[key]) payload[key] = form[key];
      }
      payload.pictures = pictures;
      await api.put('/agents/agency', payload);
      setNotice(
        agency?.isApproved
          ? 'Agency details updated.'
          : 'Submitted. An administrator will review your agency and you will be emailed the outcome.',
      );
      qc.invalidateQueries({ queryKey: ['agency'] });
      qc.invalidateQueries({ queryKey: ['agency-status'] });
    } catch (err) {
      setError(apiMessage(err, 'Could not save your agency details.'));
    }
  }

  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Your Agency</h1>
        <p className="text-sm text-gray-500">
          These details are reviewed before you can build client profiles or send invitations.
        </p>
      </div>

      {!isLoading && agency && (
        <div
          className={`card ${
            agency.isApproved ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'
          }`}
        >
          <p className={`font-medium ${agency.isApproved ? 'text-green-900' : 'text-amber-900'}`}>
            {agency.isApproved ? 'Approved' : 'Awaiting approval'}
          </p>
          <p className={`text-sm ${agency.isApproved ? 'text-green-900' : 'text-amber-900'}`}>
            {agency.isApproved
              ? 'You can build client profiles, invite clients and book on their behalf.'
              : 'You can sign in and browse, but onboarding clients is locked until an administrator approves you.'}
          </p>
          {agency.rejectionReason && (
            <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-700">
              Not approved: {agency.rejectionReason}
            </p>
          )}
        </div>
      )}

      {verification?.status && !agency?.isApproved && (
        <div className="card space-y-1 border-blue-200 bg-blue-50">
          <p className="font-medium text-blue-900">
            Field verification: {VERIFICATION_LABEL[verification.status]}
          </p>
          <p className="text-sm text-blue-900">
            An officer visits your registered address and confirms your details in person. Approval
            is their decision, not a formality on the form above.
          </p>
          {verification.remarks && (
            <p className="rounded bg-surface p-2 text-sm text-blue-900">{verification.remarks}</p>
          )}
        </div>
      )}

      {billing && (
        <div className="card space-y-2">
          <div>
            <h2 className="font-semibold text-gray-900">Your ledger</h2>
            <p className="text-sm text-gray-600">
              Fees are held in escrow and reach you when the match is fixed — you are paid for the
              outcome, not the effort.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Total label="Owed" value={billing.totals.outstanding} />
            <Total label="In escrow" value={billing.totals.inEscrow} />
            <Total label="Earned" value={billing.totals.earned} />
            <Total label="Refunded" value={billing.totals.refunded} />
          </div>
          {billing.charges.length > 0 && (
            <div className="divide-y">
              {billing.charges.slice(0, 8).map((c) => (
                <div key={c.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="capitalize text-gray-700">{c.type.replace(/_/g, ' ')}</span>
                  <span className="flex items-center gap-3">
                    <span className="tabular-nums">
                      {c.currency} {c.amount}
                    </span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-600">
                      {c.status.replace(/_/g, ' ')}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {notice && <p className="rounded bg-brand-light p-3 text-sm text-brand-dark">{notice}</p>}
      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      <form onSubmit={submit} className="card space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Agency name</label>
            <input className="input" value={form.agencyName} onChange={set('agencyName')} required />
          </div>
          <div>
            <label className="label">Registration / licence number</label>
            <input
              className="input"
              value={form.registrationNumber}
              onChange={set('registrationNumber')}
            />
          </div>
          <div>
            <label className="label">Contact number</label>
            <input
              className="input"
              placeholder="+919876543210"
              value={form.contactPhone}
              onChange={set('contactPhone')}
            />
          </div>
          <div>
            <label className="label">City</label>
            <input className="input" value={form.city} onChange={set('city')} />
          </div>
          <div>
            <label className="label">Trading since</label>
            <input
              className="input"
              type="date"
              value={form.startDate}
              onChange={set('startDate')}
            />
            <p className="mt-1 text-xs text-gray-500">
              Families ask how long you have been doing this. Answering it up front saves the
              question.
            </p>
          </div>
        </div>
        <div>
          <label className="label">Registered address</label>
          <textarea
            className="input"
            rows={2}
            maxLength={500}
            value={form.address}
            onChange={set('address')}
          />
          <p className="mt-1 text-xs text-gray-500">
            Where a verification officer will visit. It is not shown to clients.
          </p>
        </div>
        <div>
          <label className="label">About your agency</label>
          <textarea
            className="input"
            rows={3}
            maxLength={2000}
            value={form.about}
            onChange={set('about')}
          />
        </div>
        <div>
          <label className="label">Office photographs</label>
          <p className="text-xs text-gray-500">
            A real office with people in it is the single most reassuring thing on an agency
            profile.
          </p>
          {pictures.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {pictures.map((url) => (
                <div key={url} className="relative">
                  <img
                    src={url}
                    alt=""
                    className="h-24 w-32 rounded object-cover"
                    loading="lazy"
                  />
                  <button
                    type="button"
                    className="absolute right-1 top-1 rounded bg-surface/90 px-1.5 text-xs text-gray-700"
                    onClick={() => setPictures((p) => p.filter((u) => u !== url))}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              className="input flex-1"
              placeholder="https://…"
              value={pictureUrl}
              onChange={(e) => setPictureUrl(e.target.value)}
            />
            <button
              type="button"
              className="btn-outline"
              disabled={!pictureUrl.trim()}
              onClick={() => {
                setPictures((p) => [...p, pictureUrl.trim()]);
                setPictureUrl('');
              }}
            >
              Add photo
            </button>
          </div>
        </div>

        <button className="btn">{agency ? 'Save details' : 'Submit for review'}</button>
      </form>
    </div>
  );
}

function Total({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded bg-gray-50 p-3">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-gray-900">₹{value ?? '0.00'}</p>
    </div>
  );
}
