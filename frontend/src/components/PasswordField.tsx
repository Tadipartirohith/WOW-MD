import { useId, useState, type ReactNode } from 'react';
import { Eye, EyeSlash } from '@phosphor-icons/react';

/**
 * A password box you can look at.
 *
 * Masking protects against somebody reading over a shoulder, which is a real
 * risk in an office and not much of one on a phone at home. What it costs is
 * certainty: a person who cannot see what they typed either types it twice or
 * gets it wrong and blames the site. The toggle gives that back to them and
 * leaves the default masked.
 *
 * `autoComplete` is passed through rather than assumed, because the browser
 * needs to know the difference between the password somebody is signing in
 * with and the one they are choosing, and getting it wrong is how a password
 * manager saves the wrong thing.
 */
export default function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  hint,
  error,
  minLength,
  onEnter,
  labelAside,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
  error?: string;
  minLength?: number;
  onEnter?: () => void;
  /** Sits opposite the label — the sign-in form puts "Forgot?" here. */
  labelAside?: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const id = useId();

  return (
    <div>
      {labelAside ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <label className="label mb-0" htmlFor={id}>
            {label}
          </label>
          {labelAside}
        </div>
      ) : (
        <label className="label" htmlFor={id}>
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={id}
          className="input w-full pr-10"
          type={shown ? 'text' : 'password'}
          value={value}
          minLength={minLength}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onEnter) onEnter();
          }}
        />
        {/*
          Inside the field rather than beside it, so the row does not reflow
          when the label wraps. `tabIndex={-1}` keeps it out of the tab order:
          somebody moving through the form with the keyboard is heading for the
          submit button, not for a toggle they can reach by clicking.
        */}
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShown(!shown)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-600"
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
        >
          {shown ? <EyeSlash size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        </button>
      </div>
      {error ? (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-gray-500">{hint}</p>
      ) : null}
    </div>
  );
}
