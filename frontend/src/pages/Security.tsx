import { FormEvent, useEffect, useState } from 'react';
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
        <h1 className="page-title">Security</h1>
        <p className="page-subtitle">
          Your password, two-factor authentication, and the devices signed in to this account.
        </p>
      </div>

      {notice && <p className="rounded-sm bg-brand-light p-3 text-sm text-brand-dark">{notice}</p>}
      {error && <p className="alert-critical">{error}</p>}

      {user && !user.isVerified && <VerifyBanner />}

      <PhoneVerificationCard />

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
        <h2 className="section-title">Signed-in devices</h2>
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
      <DataRightsCard />

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
  // Held in component state and nowhere else: this is the only moment the
  // plaintext exists, and storing it anywhere retrievable would make it a
  // second password sitting in the browser.
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

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
      const { data } = await api.post('/auth/mfa/confirm', { code });
      setSetup(null);
      setCode('');
      setRecoveryCodes(data.recoveryCodes ?? null);
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
        <h2 className="section-title">Two-factor authentication</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            enabled ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {enabled ? 'On' : 'Off'}
        </span>
      </div>
      {error && <p className="alert-critical">{error}</p>}

      {recoveryCodes && (
        <div className="rounded-sm border border-amber-300 bg-amber-50 p-3">
          <p className="font-medium text-amber-900">Write these down now</p>
          <p className="text-sm text-amber-900">
            Each one signs you in once if you lose your authenticator. This is the only time they
            are shown. We keep them hashed, so we cannot show them to you again.
          </p>
          <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm text-amber-900">
            {recoveryCodes.map((rc) => (
              <li key={rc}>{rc}</li>
            ))}
          </ul>
          <button className="btn-outline mt-3" onClick={() => setRecoveryCodes(null)}>
            I have saved them
          </button>
        </div>
      )}

      {enabled && !recoveryCodes && <RecoveryCodeStatus onIssued={setRecoveryCodes} />}

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
          <code className="block break-all rounded-sm bg-gray-50 p-3 text-sm">{setup.secret}</code>
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
      <h2 className="section-title">Change password</h2>
      {error && <p className="alert-critical">{error}</p>}
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

/**
 * How many recovery codes are left, and a way to get more.
 *
 * Worth surfacing before somebody runs out: an admin down to their last code
 * has one authenticator failure between them and a database edit, and nothing
 * was telling them.
 */
function RecoveryCodeStatus({ onIssued }: { onIssued: (codes: string[]) => void }) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [password, setPassword] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/auth/mfa/recovery-codes')
      .then(({ data }) => setRemaining(data.remaining))
      .catch(() => setRemaining(null));
  }, []);

  async function regenerate(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const { data } = await api.post('/auth/mfa/recovery-codes', { password });
      setPassword('');
      setAsking(false);
      setRemaining(data.recoveryCodes.length);
      onIssued(data.recoveryCodes);
    } catch (err) {
      setError(apiMessage(err, 'Those codes could not be issued.'));
    }
  }

  if (remaining === null) return null;

  return (
    <div className="rounded-sm bg-gray-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-700">
          {remaining === 0
            ? 'You have no recovery codes. Without one, losing your authenticator locks you out.'
            : `${remaining} recovery code${remaining === 1 ? '' : 's'} left.`}
        </p>
        {!asking && (
          <button className="btn-outline" onClick={() => setAsking(true)}>
            {remaining === 0 ? 'Generate codes' : 'Generate new codes'}
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {asking && (
        <form onSubmit={regenerate} className="mt-2 flex flex-wrap gap-2">
          <input
            className="input flex-1"
            type="password"
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button className="btn">Issue</button>
          <button type="button" className="btn-outline" onClick={() => setAsking(false)}>
            Cancel
          </button>
        </form>
      )}
      {asking && (
        <p className="mt-1 text-xs text-gray-500">
          This replaces any codes you already have. Only your password is needed, asking for an
          authenticator code would be useless to somebody who has lost theirs.
        </p>
      )}
    </div>
  );
}

/**
 * Confirming the mobile number.
 *
 * Worth more than email verification in this market: the number is what an
 * agent takes at intake, what duplicate detection keys on, and what people
 * actually answer — and until now it was collected, format-checked and then
 * trusted without ever being tested.
 */
function PhoneVerificationCard() {
  const [state, setState] = useState<'idle' | 'sent' | 'done'>('idle');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState('');
  const [error, setError] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);

  useEffect(() => {
    api
      .get('/auth/me')
      .then(({ data }) => {
        setPhone(data.phone ?? null);
        setVerifiedAt(data.phoneVerifiedAt ?? null);
        if (data.phoneVerifiedAt) setState('done');
      })
      .catch(() => undefined);
  }, []);

  async function send() {
    setError('');
    try {
      const { data } = await api.post('/auth/phone/send-code');
      setDevCode(data.devCode ?? '');
      setState('sent');
    } catch (err) {
      setError(apiMessage(err, 'That code could not be sent.'));
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/auth/phone/verify', { code });
      setCode('');
      setState('done');
      setVerifiedAt(new Date().toISOString());
    } catch (err) {
      setError(apiMessage(err, 'That code was not accepted.'));
    }
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="section-title">Mobile number</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            verifiedAt ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {verifiedAt ? 'Verified' : 'Not verified'}
        </span>
      </div>

      {error && <p className="alert-critical">{error}</p>}

      {!phone && (
        <p className="text-sm text-gray-600">
          There is no mobile number on your account. Add one on your profile first. It is how most
          families here are actually reached.
        </p>
      )}

      {phone && state === 'done' && (
        <p className="text-sm text-gray-600">
          {phone} is confirmed. Invitations, reminders and account notices can reach you there.
        </p>
      )}

      {phone && state === 'idle' && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-gray-600">
            We will text a six-digit code to {phone}.
          </p>
          <button className="btn" onClick={send}>
            Send the code
          </button>
        </div>
      )}

      {phone && state === 'sent' && (
        <form onSubmit={verify} className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="text-gray-700">Six-digit code</span>
            <input
              className="input mt-1 w-40"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            {devCode && (
              <span className="mt-1 block text-xs text-gray-500">
                Development mode: the code is {devCode}
              </span>
            )}
          </label>
          <button className="btn">Verify</button>
          <button type="button" className="btn-outline" onClick={send}>
            Resend
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * Export and deletion.
 *
 * Last on the page and visually quiet: these are rights, not features, and
 * putting a delete button next to the password field is how people press it by
 * accident. Export is one click because there is nothing to think about; the
 * deletion asks for the password and says plainly what survives.
 */
function DataRightsCard() {
  const clear = useAuth((s) => s.clear);
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function exportData() {
    setError('');
    setBusy(true);
    try {
      const { data } = await api.get('/users/me/export');
      // Built and revoked here rather than linked, so nothing about the account
      // ends up in a URL or a server log on the way out.
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `wow-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(apiMessage(err, 'That export could not be produced.'));
    } finally {
      setBusy(false);
    }
  }

  async function erase(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/users/me/erase', { password });
      clear();
      window.location.href = '/login';
    } catch (err) {
      setError(apiMessage(err, 'Your account could not be deleted.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <h2 className="section-title">Your data</h2>

      {error && <p className="alert-critical">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600">
          Download everything held about you: your profile, biodata, consent record, who your
          details were shared with, and your bookings.
        </p>
        <button className="btn-outline" onClick={exportData} disabled={busy}>
          Download
        </button>
      </div>

      <div className="border-t pt-3">
        {!asking ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-gray-600">
              Delete your account and personal record.
            </p>
            <button className="btn-outline text-red-600" onClick={() => setAsking(true)}>
              Delete my account
            </button>
          </div>
        ) : (
          <form onSubmit={erase} className="space-y-2">
            <p className="text-sm text-gray-700">
              Your profile, biodata and photographs are deleted. Your consent record and the
              financial record of any bookings are kept. They are what the platform answers for
              its own conduct with, and they no longer identify you.
            </p>
            <p className="text-sm text-gray-600">
              This cannot be undone, and it is refused while any booking is still in progress.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                className="input flex-1"
                type="password"
                placeholder="Confirm with your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button className="btn bg-red-600 hover:bg-red-700" disabled={busy}>
                {busy ? 'Deleting…' : 'Delete permanently'}
              </button>
              <button type="button" className="btn-outline" onClick={() => setAsking(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
