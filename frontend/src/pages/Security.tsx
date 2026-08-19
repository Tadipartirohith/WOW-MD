import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';

interface Session {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  current: boolean;
}

/** Turns a raw user-agent into something a person can recognise. */
function describeDevice(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox'
    : 'Browser';
  const os =
    /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return os ? `${browser} on ${os}` : browser;
}

export default function Security() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const { data: sessions } = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => (await api.get('/auth/sessions')).data as Session[],
    retry: false,
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/auth/sessions/${id}`)).data,
    onSuccess: () => {
      setNotice('That device has been signed out.');
      qc.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (err) => setError(apiMessage(err)),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-brand-dark">Security</h1>
        <p className="text-sm text-gray-500">
          Your password, two-factor authentication, and the devices signed in to this account.
        </p>
      </div>

      {notice && <p className="rounded bg-brand-light p-3 text-sm text-brand-dark">{notice}</p>}
      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      {user && !user.isVerified && <VerifyBanner />}

      <TwoFactorCard
        enabled={Boolean(user?.mfaEnabled)}
        onChanged={(enabled) => {
          setUser({ mfaEnabled: enabled });
          setNotice(
            enabled ? 'Two-factor authentication is now on.' : 'Two-factor authentication is off.',
          );
        }}
      />

      <ChangePasswordCard onDone={() => setNotice('Password changed. Sign in again to continue.')} />

      <div className="card space-y-3">
        <h2 className="font-semibold text-gray-900">Signed-in devices</h2>
        <p className="text-sm text-gray-500">
          Each device gets its own session, so signing in somewhere new never signs you out here.
        </p>
        <div className="divide-y">
          {(sessions ?? []).map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">
                  {describeDevice(s.userAgent)}
                  {s.current && (
                    <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">
                      This device
                    </span>
                  )}
                </p>
                <p className="text-sm text-gray-500">
                  {s.ip ?? 'unknown address'} &middot; signed in{' '}
                  {new Date(s.createdAt).toLocaleString()}
                </p>
              </div>
              {!s.current && (
                <button className="btn-outline" onClick={() => revoke.mutate(s.id)}>
                  Sign out
                </button>
              )}
            </div>
          ))}
          {!sessions?.length && <p className="text-sm text-gray-400">No active sessions.</p>}
        </div>
      </div>
    </div>
  );
}

function VerifyBanner() {
  const [sent, setSent] = useState(false);
  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50">
      <p className="text-sm text-amber-900">
        Your email address has not been confirmed yet. Confirming it protects your account and lets
        you recover it if you forget your password.
      </p>
      <button
        className="btn-outline"
        disabled={sent}
        onClick={async () => {
          await api.post('/auth/verify-email/resend').catch(() => undefined);
          setSent(true);
        }}
      >
        {sent ? 'Email sent' : 'Resend confirmation'}
      </button>
    </div>
  );
}

/**
 * Two-factor setup is two steps on purpose: the secret is stored when setup
 * begins, but 2FA only switches on once a generated code is confirmed — so an
 * abandoned setup can never lock anyone out of their own account.
 */
function TwoFactorCard({
  enabled,
  onChanged,
}: {
  enabled: boolean;
  onChanged: (enabled: boolean) => void;
}) {
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function begin() {
    setError('');
    try {
      const { data } = await api.post('/auth/mfa/setup');
      setSetup(data);
    } catch (err) {
      setError(apiMessage(err));
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/auth/mfa/confirm', { code });
      setSetup(null);
      setCode('');
      onChanged(true);
    } catch (err) {
      setError(apiMessage(err, 'That code was not accepted.'));
    }
  }

  async function disable(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/auth/mfa/disable', { password, code });
      setPassword('');
      setCode('');
      onChanged(false);
    } catch (err) {
      setError(apiMessage(err));
    }
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">Two-factor authentication</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            enabled ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {enabled ? 'On' : 'Off'}
        </span>
      </div>
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}

      {enabled ? (
        <form onSubmit={disable} className="space-y-3">
          <p className="text-sm text-gray-600">
            Turning two-factor off needs both your password and a current code.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="input"
              type="password"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <input
              className="input"
              inputMode="numeric"
              maxLength={6}
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </div>
          <button className="btn-outline">Turn off two-factor</button>
        </form>
      ) : setup ? (
        <form onSubmit={confirm} className="space-y-3">
          <p className="text-sm text-gray-600">
            Add this secret to your authenticator app, then enter the code it shows.
          </p>
          <code className="block break-all rounded bg-gray-50 p-3 text-sm">{setup.secret}</code>
          <p className="break-all text-xs text-gray-500">{setup.otpauthUrl}</p>
          <input
            className="input max-w-[12rem]"
            inputMode="numeric"
            maxLength={6}
            placeholder="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
          <button className="btn">Confirm and turn on</button>
        </form>
      ) : (
        <>
          <p className="text-sm text-gray-600">
            Adds a second step at sign-in, so a stolen password is not enough on its own.
            Administrators are required to keep this on.
          </p>
          <button className="btn" onClick={begin}>
            Set up two-factor
          </button>
        </>
      )}
    </div>
  );
}

function ChangePasswordCard({ onDone }: { onDone: () => void }) {
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/auth/password/change', { currentPassword, newPassword });
      setCurrent('');
      setNew('');
      onDone();
    } catch (err) {
      setError(apiMessage(err));
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <h2 className="font-semibold text-gray-900">Change password</h2>
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}
      <p className="text-sm text-gray-500">
        Changing your password signs out every device, including this one.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          className="input"
          type="password"
          placeholder="Current password"
          value={currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
        <input
          className="input"
          type="password"
          minLength={8}
          placeholder="New password"
          value={newPassword}
          onChange={(e) => setNew(e.target.value)}
          required
        />
      </div>
      <button className="btn">Change password</button>
    </form>
  );
}
