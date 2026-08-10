import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';

const ROLES = ['bride', 'groom', 'family', 'vendor'];

export default function Register() {
  const nav = useNavigate();
  const setAuth = useAuth((s) => s.setAuth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('bride');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', { email, password, role });
      setAuth(data);
      nav('/profile');
    } catch {
      setError('Could not register, email may already be in use, or password too short (min 8).');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold text-brand">Create your WOW account</h1>
        {error && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <div>
          <label className="label">I am a</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <button className="btn w-full" disabled={loading}>
          {loading ? 'Creating...' : 'Register'}
        </button>
        <p className="text-center text-sm text-gray-500">
          Have an account? <Link className="text-brand" to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
