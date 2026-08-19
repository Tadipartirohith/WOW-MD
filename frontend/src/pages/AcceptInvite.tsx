import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';

interface InvitationPreview {
  displayName: string;
  email: string;
  invitedBy: string;
  city: string | null;
  photoCount: number;
  expiresAt: string;
}

/**
 * Where an invited person lands from their email.
 *
 * The agent (or family member) who built the profile never sees this password:
 * the subject sets it here, which is the whole point of the invitation flow.
 * Accepting also verifies the email address, since following the link proved
 * control of it.
 */
export default function AcceptInvite() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  const setAuth = useAuth((s) => s.setAuth);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { data, isLoading, isError, error: previewError } = useQuery({
    queryKey: ['invitation', token],
    queryFn: async () => (await api.get(`/auth/invitations/${token}`)).data as InvitationPreview,
    retry: false,
    enabled: Boolean(token),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/auth/invitations/accept', { token, password });
      setAuth(res.data);
      nav('/profile');
    } catch (err) {
      setError(apiMessage(err, 'That invitation could not be accepted.'));
    } finally {
      setLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-gray-500">Checking your invitation…</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="card w-full max-w-md text-center">
          <p className="text-4xl" aria-hidden>
            ⌛
          </p>
          <h1 className="mt-2 text-xl font-bold text-brand-dark">This invitation is not usable</h1>
          <p className="mt-2 text-sm text-gray-600">
            {apiMessage(previewError, 'The link may have expired or already been used.')} Ask
            whoever invited you to send a new one.
          </p>
          <Link to="/login" className="btn mt-4">
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  const expires = new Date(data.expiresAt).toLocaleDateString();

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <form onSubmit={submit} className="card w-full max-w-md space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-brand">Welcome, {data.displayName}</h1>
          <p className="mt-2 text-sm text-gray-600">
            <strong>{data.invitedBy}</strong> has prepared a profile for you
            {data.city ? ` in ${data.city}` : ''}
            {data.photoCount > 0
              ? `, with ${data.photoCount} photo${data.photoCount === 1 ? '' : 's'}`
              : ''}
            . Choose a password to take ownership of it.
          </p>
        </div>

        <div className="rounded-lg bg-brand-light p-3 text-sm text-brand-dark">
          Once you accept, the profile is yours: only you can edit it, and{' '}
          <strong>{data.invitedBy}</strong> can no longer change it. This link expires on {expires}.
        </div>

        {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}

        <div>
          <label className="label">Your email</label>
          <input className="input bg-gray-50" value={data.email} readOnly disabled />
          <p className="mt-1 text-xs text-gray-500">
            You will sign in with this address. It is confirmed automatically by using this link.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="password">
            Choose a password
          </label>
          <input
            id="password"
            className="input"
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <p className="mt-1 text-xs text-gray-500">
            At least 8 characters, with an uppercase letter, a lowercase letter and a digit.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="confirm">
            Confirm password
          </label>
          <input
            id="confirm"
            className="input"
            type="password"
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>

        <button className="btn w-full" disabled={loading}>
          {loading ? 'Setting up your account…' : 'Accept and create my account'}
        </button>

        <p className="text-center text-sm text-gray-500">
          Not you?{' '}
          <Link className="text-brand" to="/register">
            Create your own account instead
          </Link>
        </p>
      </form>
    </div>
  );
}
