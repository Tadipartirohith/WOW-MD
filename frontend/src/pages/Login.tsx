import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AxiosError } from 'axios';
import { api, apiMessage } from '../lib/api';
import { motion, useReducedMotion } from 'motion/react';
import { CircleNotch, WarningCircle } from '@phosphor-icons/react';
import { useAuth } from '../store/auth';
import SupportContact from '../components/SupportContact';
import PasswordField from '../components/PasswordField';

export default function Login() {
  const nav = useNavigate();
  const setAuth = useAuth((s) => s.setAuth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  /** Flipped once the server tells us this account has two-factor on. */
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const reduce = useReducedMotion();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', {
        email,
        password,
        ...(needsMfa ? { mfaCode } : {}),
      });
      setAuth(data);
      nav('/');
    } catch (err) {
      const body = (err as AxiosError<{ code?: string }>).response?.data;
      if (body?.code === 'MFA_REQUIRED') {
        // Not an error the user caused: ask for the second factor instead.
        setNeedsMfa(true);
        setError('');
      } else {
        setError(apiMessage(err, 'Invalid email or password.'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    /*
     * A split. The form sits left at a comfortable reading width; the right
     * half is the only place in the whole application where the product gets
     * to say what it is for before asking for anything.
     *
     * Below `lg` the panel is dropped rather than stacked. A photograph above
     * a sign-in form on a phone is a photograph somebody scrolls past to reach
     * the thing they opened the page to do.
     */
    <div className="grid min-h-[100dvh] lg:grid-cols-[minmax(0,1fr)_1.1fr]">
      <div className="flex items-center justify-center px-6 py-12 sm:px-10">
        <motion.form
          onSubmit={submit}
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-[22rem]"
        >
          <Link to="/" className="mb-10 flex items-baseline gap-2">
            <span className="text-[1.5rem] font-semibold tracking-[-0.04em] text-gray-900">WOW</span>
            <span className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-gray-400">
              World of Weddings
            </span>
          </Link>

          <h1 className="text-hero font-semibold text-gray-900">Welcome back</h1>
          <p className="page-subtitle mb-8">
            Sign in to pick up where your family left off.
          </p>

          {error && (
            <p
              role="alert"
              className="mb-5 flex items-start gap-2 rounded-md bg-critical-bg px-3 py-2.5 text-sm text-critical-fg"
            >
              <WarningCircle size={17} className="mt-px shrink-0" aria-hidden />
              {error}
            </p>
          )}

          <div className="space-y-4">
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <PasswordField
              label="Password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              labelAside={
                <Link
                  className="text-[0.8125rem] text-gray-500 underline-offset-2 transition-colors hover:text-brand-strong hover:underline"
                  to="/forgot-password"
                >
                  Forgot?
                </Link>
              }
            />

            {needsMfa && (
              <div>
                <label className="label" htmlFor="mfaCode">
                  Authentication code
                </label>
                <input
                  id="mfaCode"
                  className="input font-mono tracking-[0.35em]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  autoFocus
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  required
                />
                <p className="mt-1.5 text-xs text-gray-500">
                  Open your authenticator app and enter the current 6-digit code.
                </p>
              </div>
            )}
          </div>

          <button className="btn mt-6 w-full" disabled={loading}>
            {loading && (
              <CircleNotch size={16} className="animate-spin" aria-hidden />
            )}
            {loading ? 'Signing in' : 'Sign in'}
          </button>

          <p className="mt-6 text-center text-sm text-gray-500">
            No account?{' '}
            <Link
              className="font-medium text-brand-strong underline-offset-2 hover:underline"
              to="/register"
            >
              Register
            </Link>
          </p>

          {/*
            Here rather than only inside the app.

            Somebody who cannot get past this screen is exactly the person who
            needs a phone number, and a contact address visible only after
            signing in is no use to them. Renders nothing when no channel is
            configured, so it never leaves a dead heading behind.
          */}
          <div className="mt-4 border-t border-gray-100 pt-4">
            <SupportContact compact />
          </div>
        </motion.form>
      </div>

      {/*
        The right half. A real photograph rather than a gradient: this is a
        product about weddings, and a page that shows none is a page that could
        be selling anything.
      */}
      <div className="relative hidden overflow-hidden bg-scrim lg:block">
        {/*
          TODO: this slot wants a real brand photograph, 1400x1800 portrait.

          Picsum's seed is stable but says nothing about what is *in* the
          picture, and a stock photograph of a stranger's wedding would be
          worse than none. So it is blurred past recognition and used as a
          ground: a field of tone behind the statement rather than a subject
          competing with it. Swap in the real asset and drop the blur.
        */}
        <img
          src="https://picsum.photos/seed/wow-atmosphere-01/1400/1800?grayscale&blur=10"
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30"
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-brand/25 via-transparent to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-scrim via-scrim/75 to-scrim/30" />
        <div className="absolute inset-x-0 bottom-0 p-12">
          <p className="max-w-[26ch] text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.028em] text-white">
            Every family deserves to know who they are talking to.
          </p>
          <p className="mt-3 max-w-[42ch] text-sm leading-relaxed text-white/70">
            Identity verified in person. Contact details never leave the platform until both
            sides agree.
          </p>
        </div>
      </div>
    </div>
  );
}
