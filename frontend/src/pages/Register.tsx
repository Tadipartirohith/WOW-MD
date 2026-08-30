import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AxiosError } from 'axios';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import type { AccountType } from '../lib/permissions';
import { EMAIL_PATTERN, MOBILE_10_PATTERN, NAME_PATTERN } from '../lib/permissions';

/**
 * Sign-up is a two-step choice: first *what kind of account*, then the details.
 * The account type decides which persona (and therefore which permission set)
 * the new account gets, so it is the first thing we ask for.
 */
interface AccountTypeOption {
  type: AccountType;
  label: string;
  blurb: string;
  icon: string;
  /** Individual accounts additionally pick bride/groom/family. */
  roles?: { value: string; label: string }[];
}

const ACCOUNT_TYPES: AccountTypeOption[] = [
  {
    type: 'individual',
    label: 'Individual',
    blurb: 'Looking for a match, or a family member searching on their behalf.',
    icon: '💍',
    roles: [
      { value: 'bride', label: 'Bride' },
      { value: 'groom', label: 'Groom' },
      { value: 'family', label: 'Family member' },
    ],
  },
  {
    type: 'agent',
    label: 'Marriage agent',
    blurb:
      'Build profiles for clients, invite them to claim their account, and book on their behalf. Reviewed before activation.',
    icon: '🤝',
  },
  {
    type: 'vendor',
    label: 'Vendor',
    blurb: 'Sell wedding services: venue, catering, photography, decor and more.',
    icon: '🏛️',
  },
  {
    type: 'planner',
    label: 'Wedding planner',
    blurb: 'Offer planning packages and co-manage the weddings you are engaged on.',
    icon: '📋',
  },
];

export default function Register() {
  const nav = useNavigate();
  const setAuth = useAuth((s) => s.setAuth);

  const [accountType, setAccountType] = useState<AccountType>('individual');
  const [role, setRole] = useState('bride');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const selected = ACCOUNT_TYPES.find((a) => a.type === accountType)!;
  // A business is reached on its number, so it is required; an individual can
  // sign up on an email alone and add one later.
  const phoneRequired = accountType !== 'individual';

  /**
   * The same rules the server applies, checked before the round trip.
   *
   * Field-level and specific: "Enter a 10-digit mobile number" beats a single
   * banner saying the form is invalid, because it says which field and what to
   * do about it. The server still enforces all of this.
   */
  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    const name = displayName.trim();
    const digits = phone.replace(/\s|-/g, '').replace(/^\+91/, '');

    if (!name) errors.displayName = 'Enter your name';
    else if (accountType === 'individual' && !NAME_PATTERN.test(name)) {
      errors.displayName = 'A name may only contain letters and spaces';
    }

    if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Enter a valid email address';

    if (phoneRequired && !digits) errors.phone = 'A business account needs a contact number';
    else if (digits && !MOBILE_10_PATTERN.test(digits)) {
      errors.phone = 'Enter a 10-digit Indian mobile number, starting 6 to 9';
    }

    if (password.length < 8) errors.password = 'At least 8 characters';
    else if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
      errors.password = 'Needs an uppercase letter, a lowercase letter and a digit';
    }

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
      const payload: Record<string, unknown> = {
        email: email.trim(),
        password,
        accountType,
        displayName: displayName.trim(),
      };
      if (phone.trim()) payload.phone = phone.replace(/\s|-/g, '');
      // `role` is only meaningful for individual sign-ups; the server derives it
      // from accountType for every other persona.
      if (accountType === 'individual') payload.role = role;

      const { data } = await api.post('/auth/register', payload);
      setAuth(data);
      // Agents land on agency registration: nothing else works until an
      // administrator has approved them.
      if (accountType === 'agent') nav('/agency');
      else nav(accountType === 'individual' ? '/profile' : '/');
    } catch (err) {
      const res = (err as AxiosError<{ message?: string | string[] }>).response;
      const msg = res?.data?.message;
      setError(
        Array.isArray(msg)
          ? msg.join('. ')
          : msg || 'Could not register. The email may already be in use.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <form onSubmit={submit} className="card w-full max-w-2xl space-y-6" noValidate>
        <div>
          <h1 className="page-title">Create your WOW account</h1>
          <p className="mt-1 text-sm text-gray-500">
            Pick the kind of account you need. This decides what you can do on the platform, and
            you cannot change it later without contacting support.
          </p>
        </div>

        {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}

        <fieldset>
          <legend className="label">I am joining as</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {ACCOUNT_TYPES.map((opt) => {
              const active = opt.type === accountType;
              return (
                <button
                  type="button"
                  key={opt.type}
                  onClick={() => setAccountType(opt.type)}
                  aria-pressed={active}
                  className={`rounded-lg border p-3 text-left transition ${
                    active
                      ? 'border-brand bg-brand-light ring-1 ring-brand'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <span className="text-lg" aria-hidden>
                    {opt.icon}
                  </span>
                  <p className="font-medium text-gray-900">{opt.label}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{opt.blurb}</p>
                </button>
              );
            })}
          </div>
        </fieldset>

        {selected.roles && (
          <div>
            <label className="label" htmlFor="role">
              Who is this profile for?
            </label>
            <select
              id="role"
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              {selected.roles.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="displayName">
              {accountType === 'individual' ? 'Full name' : 'Your name'}
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
            {fieldErrors.email && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.email}</p>
            )}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="phone">
            Mobile number{' '}
            {!phoneRequired && <span className="font-normal text-gray-400">(optional)</span>}
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

        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="input"
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={Boolean(fieldErrors.password)}
          />
          {fieldErrors.password ? (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.password}</p>
          ) : (
            <p className="mt-1 text-xs text-gray-500">
              At least 8 characters, with an uppercase letter, a lowercase letter and a digit.
            </p>
          )}
        </div>

        <button className="btn w-full" disabled={loading}>
          {loading ? 'Creating...' : `Create ${selected.label.toLowerCase()} account`}
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
