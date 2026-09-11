import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import PasswordField from '../components/PasswordField';
import { EMAIL_PATTERN, GMAIL_PATTERN, MOBILE_10_PATTERN, NAME_PATTERN } from '../lib/permissions';

interface AgentLinkPreview {
  agencyName: string;
  city: string | null;
}

const ROLES = [
  { value: 'bride', label: 'Bride' },
  { value: 'groom', label: 'Groom' },
  { value: 'family', label: 'Family member' },
];

/**
 * Where a new client lands from an agency's shared sign-up link (EZ1-I166).
 *
 * This is a self-service registration, not a claim: there is no profile waiting
 * for them. They create their own account — choosing their own password, which
 * the agent never sees — and it lands in that agency's book. Mobile and email
 * are both required, the same two factors the invitation flow asks for.
 */
export default function AgentSignup() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  const setAuth = useAuth((s) => s.setAuth);

  const [role, setRole] = useState('bride');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const { data, isLoading, isError, error: previewError } = useQuery({
    queryKey: ['agent-link', token],
    queryFn: async () => (await api.get(`/auth/agent-link/${token}`)).data as AgentLinkPreview,
    retry: false,
    enabled: Boolean(token),
  });

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    const name = displayName.trim();
    const digits = phone.replace(/\s|-/g, '').replace(/^\+91/, '');

    if (!name) errors.displayName = 'Enter your name';
    else if (!NAME_PATTERN.test(name)) errors.displayName = 'A name may only contain letters and spaces';

    if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Enter a valid email address';
    else if (!GMAIL_PATTERN.test(email.trim())) {
      errors.email = 'Registration requires a @gmail.com email address';
    }

    if (!digits) errors.phone = 'Enter your mobile number';
    else if (!MOBILE_10_PATTERN.test(digits)) {
      errors.phone = 'Enter a 10-digit Indian mobile number, starting 6 to 9';
    }

    if (password.length < 8) errors.password = 'At least 8 characters';
    else if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
      errors.password = 'Needs an uppercase letter, a lowercase letter and a digit';
    }

    if (!confirm) errors.confirm = 'Type the password again';
    else if (confirm !== password) errors.confirm = 'Passwords do not match';

    return errors;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setLoading(true);
    try {
      const { data: auth } = await api.post('/auth/agent-link/register', {
        token,
        accountType: 'individual',
        role,
        displayName: displayName.trim(),
        email: email.trim(),
        phone: phone.replace(/\s|-/g, ''),
        password,
      });
      setAuth(auth);
      nav('/profile');
    } catch (err) {
      setError(apiMessage(err, 'Could not create your account. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-gray-500">Checking your link…</p>
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
          <h1 className="page-title mt-2">This sign-up link is not usable</h1>
          <p className="page-subtitle">
            {apiMessage(previewError, 'The link may have been withdrawn or replaced.')} Ask the
            agent who shared it for a new one.
          </p>
          <Link to="/login" className="btn mt-4">
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <form onSubmit={submit} className="card w-full max-w-2xl space-y-6" noValidate>
        <div>
          <h1 className="page-title">Create your WOW account</h1>
          <p className="page-subtitle">
            <strong>{data.agencyName}</strong>
            {data.city ? ` in ${data.city}` : ''} invited you to sign up. Your account will be
            looked after by them, and you choose your own password — they never see it.
          </p>
        </div>

        {error && <p className="alert-critical">{error}</p>}

        <div>
          <label className="label" htmlFor="role">
            Who is this profile for?
          </label>
          <select id="role" className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="displayName">
              Full name
            </label>
            <input
              id="displayName"
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={120}
              aria-invalid={Boolean(fieldErrors.displayName)}
            />
            {fieldErrors.displayName && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.displayName}</p>
            )}
          </div>
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
              aria-invalid={Boolean(fieldErrors.email)}
            />
            {fieldErrors.email && <p className="mt-1 text-xs text-red-600">{fieldErrors.email}</p>}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="phone">
            Mobile number
          </label>
          <input
            id="phone"
            className="input"
            inputMode="numeric"
            placeholder="9876543210"
            maxLength={13}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-invalid={Boolean(fieldErrors.phone)}
          />
          {fieldErrors.phone ? (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.phone}</p>
          ) : (
            <p className="mt-1 text-xs text-gray-500">
              Ten digits, starting 6 to 9. The +91 is added for you.
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <PasswordField
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            minLength={8}
            error={fieldErrors.password}
            hint="At least 8 characters, with an uppercase letter, a lowercase letter and a digit."
          />
          <PasswordField
            label="Confirm password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            error={fieldErrors.confirm}
            hint="Type it again so a slip does not lock you out."
          />
        </div>

        <button className="btn w-full" disabled={loading}>
          {loading ? 'Creating…' : 'Create my account'}
        </button>

        <p className="text-center text-sm text-gray-500">
          Have an account?{' '}
          <Link className="text-brand" to="/login">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
