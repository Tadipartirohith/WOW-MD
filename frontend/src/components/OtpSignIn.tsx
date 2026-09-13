import { FormEvent, useEffect, useState } from 'react';
import { AxiosError } from 'axios';
import { CircleNotch, WarningCircle } from '@phosphor-icons/react';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';

/**
 * Signing in with a mobile number and a code (EZ1-I258).
 *
 * The number is what most of this platform's people were taken on with: an
 * agent signs a family up on the phone, and the address and password they
 * invented at intake are the part they cannot remember months later. The code
 * that arrives by SMS is the credential that works for them, and it reaches the
 * same account, with the same role and permissions, as the password does.
 *
 * Two steps on one form. Asking for the number and then replacing it with a
 * code box would take away the thing somebody is checking against the message
 * that has just arrived, so the number stays and the code appears under it.
 *
 * Every rule that makes six digits a credential belongs to the server: the code
 * expires, three wrong guesses spend it, one use consumes it, and both routes
 * are rate-limited. This only says what happened.
 */
const RESEND_SECONDS = 30;

export default function OtpSignIn({
  onUsePassword,
  onSignedIn,
}: {
  onUsePassword: () => void;
  onSignedIn: () => void;
}) {
  const setAuth = useAuth((s) => s.setAuth);
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [sent, setSent] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  /** Seconds until "Send it again" becomes pressable. */
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const digits = mobile.replace(/[\s-]/g, '').replace(/^\+91/, '');
  const numberLooksRight = /^[6-9]\d{9}$/.test(digits);

  async function request() {
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/otp/request', { mobile: digits });
      setSent(true);
      setCooldown(RESEND_SECONDS);
      /*
       * In development the platform logs the message instead of sending it and
       * hands the code back, or the flow would be unusable. It is the whole
       * credential, so it only ever appears in that mode — and saying where it
       * came from beats six digits appearing unexplained.
       */
      setNotice(
        data?.devCode
          ? `Development mode: your code is ${data.devCode}.`
          : 'If that number has an account, a code is on its way.',
      );
    } catch (err) {
      setError(apiMessage(err, 'That code could not be sent. Try again in a minute.'));
    } finally {
      setLoading(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/otp/login', {
        mobile: digits,
        code,
        ...(needsMfa ? { mfaCode } : {}),
      });
      setAuth(data);
      onSignedIn();
    } catch (err) {
      // The global filter nests the thrown payload under 'error', which is
      // where the challenge code lands — never at the top level.
      const body = (err as AxiosError<{ error?: { code?: string } }>).response?.data?.error;
      if (body?.code === 'MFA_REQUIRED') {
        setNeedsMfa(true);
        setError('');
        setNotice('');
      } else {
        setError(apiMessage(err, 'That code is not right.'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={sent ? verify : (e) => { e.preventDefault(); void request(); }}>
      {error && (
        <p
          role="alert"
          className="mb-5 flex items-start gap-2 rounded-md bg-critical-bg px-3 py-2.5 text-sm text-critical-fg"
        >
          <WarningCircle size={17} className="mt-px shrink-0" aria-hidden />
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="mb-5 rounded-md bg-positive-bg px-3 py-2.5 text-sm text-positive-fg">
          {notice}
        </p>
      )}

      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="otp-mobile">
            Mobile number
          </label>
          <input
            id="otp-mobile"
            className="input"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            maxLength={13}
            placeholder="9876543210"
            value={mobile}
            onChange={(e) => {
              setMobile(e.target.value);
              // Changing the number invalidates everything about the last one;
              // the server would refuse the old code anyway.
              if (sent) {
                setSent(false);
                setCode('');
                setNotice('');
                setNeedsMfa(false);
              }
            }}
            required
          />
          {!sent && (
            <p className="mt-1.5 text-xs text-gray-500">
              Ten digits, the number your account was set up with.
            </p>
          )}
        </div>

        {sent && (
          <div>
            <label className="label" htmlFor="otp-code">
              Code
            </label>
            <input
              id="otp-code"
              className="input font-mono tracking-[0.35em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            <p className="mt-1.5 text-xs text-gray-500">The six digits we sent by SMS.</p>
          </div>
        )}

        {needsMfa && (
          <div>
            <label className="label" htmlFor="otp-mfa">
              Authentication code
            </label>
            <input
              id="otp-mfa"
              className="input font-mono tracking-[0.35em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              required
            />
            <p className="mt-1.5 text-xs text-gray-500">
              Two-factor is on for this account, so this step confirms it is you.
            </p>
          </div>
        )}
      </div>

      <button
        className="btn mt-6 w-full"
        disabled={loading || (!sent && !numberLooksRight) || (sent && code.length < 6)}
      >
        {loading && <CircleNotch size={16} className="animate-spin" aria-hidden />}
        {sent ? 'Sign in' : 'Send me a code'}
      </button>

      {sent && (
        <button
          type="button"
          className="btn-ghost btn-sm mt-2 w-full"
          disabled={loading || cooldown > 0}
          onClick={() => void request()}
        >
          {cooldown > 0 ? `Send it again in ${cooldown}s` : 'Send it again'}
        </button>
      )}

      <button type="button" className="btn-ghost btn-sm mt-2 w-full" onClick={onUsePassword}>
        Sign in with an email address instead
      </button>
    </form>
  );
}
