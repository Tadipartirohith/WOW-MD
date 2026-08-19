import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AxiosError } from 'axios';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';

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
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold text-brand">WOW, Sign in</h1>
        {error && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}

        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {needsMfa && (
          <div>
            <label className="label" htmlFor="mfaCode">
              Authentication code
            </label>
            <input
              id="mfaCode"
              className="input"
              inputMode="numeric"
              maxLength={6}
              autoFocus
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              Open your authenticator app and enter the current 6-digit code.
            </p>
          </div>
        )}

        <button className="btn w-full" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>

        <p className="text-center text-sm text-gray-500">
          <Link className="text-brand" to="/forgot-password">
            Forgot your password?
          </Link>
        </p>
        <p className="text-center text-sm text-gray-500">
          No account?{' '}
          <Link className="text-brand" to="/register">
            Register
          </Link>
        </p>
      </form>
    </div>
  );
}
