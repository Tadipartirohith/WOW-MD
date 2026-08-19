import { FormEvent, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';

interface Agency {
  id: string;
  agencyName: string;
  registrationNumber: string | null;
  contactPhone: string | null;
  city: string | null;
  about: string | null;
  isApproved: boolean;
  rejectionReason: string | null;
}

const empty = {
  agencyName: '',
  registrationNumber: '',
  contactPhone: '',
  city: '',
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
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

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
        about: agency.about ?? '',
      });
    }
  }, [agency]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      const payload: Record<string, unknown> = { agencyName: form.agencyName };
      for (const key of ['registrationNumber', 'contactPhone', 'city', 'about'] as const) {
        if (form[key]) payload[key] = form[key];
      }
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
        <h1 className="text-xl font-bold text-brand-dark">Your Agency</h1>
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
        <button className="btn">{agency ? 'Save details' : 'Submit for review'}</button>
      </form>
    </div>
  );
}
