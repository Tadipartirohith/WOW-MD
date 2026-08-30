import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';

export default function ResetPassword() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/password/reset', { token, password });
      setDone(true);
      setTimeout(() => nav('/login'), 2500);
    } catch (err) {
      setError(apiMessage(err, 'That reset link is no longer valid.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm space-y-4">
        <h1 className="page-title">Choose a new password</h1>

        {done ? (
          <>
            <p className="rounded bg-brand-light p-3 text-sm text-brand-dark">
              Your password has been changed, and every device that was signed in has been signed
              out. Taking you to sign in...
            </p>
            <Link to="/login" className="btn w-full">
              Sign in now
            </Link>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}
            <div>
              <label className="label" htmlFor="password">
                New password
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
              {loading ? 'Saving...' : 'Change password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
