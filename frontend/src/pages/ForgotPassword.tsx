import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

/**
 * The response is intentionally identical whether or not the address exists —
 * telling an anonymous caller which emails are registered would hand out an
 * account-enumeration oracle, so the UI says the same thing either way.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/password/forgot', { email });
    } catch {
      // Deliberately swallowed: the outcome must not differ by address.
    } finally {
      setSent(true);
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm space-y-4">
        <h1 className="page-title">Reset your password</h1>

        {sent ? (
          <>
            <p className="rounded bg-brand-light p-3 text-sm text-brand-dark">
              If an account exists for <strong>{email}</strong>, a reset link is on its way. It
              works once and expires shortly.
            </p>
            <Link to="/login" className="btn w-full">
              Back to sign in
            </Link>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-gray-600">
              Enter your email address and we will send you a link to choose a new password.
            </p>
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
            <button className="btn w-full" disabled={loading}>
              {loading ? 'Sending...' : 'Send reset link'}
            </button>
            <p className="text-center text-sm text-gray-500">
              <Link className="text-brand" to="/login">
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
