import { Link } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { ROLE_LABEL } from '../lib/permissions';

/** Shown when a signed-in persona reaches a page their account type cannot use. */
export default function Forbidden() {
  const user = useAuth((s) => s.user);
  return (
    <div className="card mx-auto max-w-lg text-center">
      <p className="text-4xl" aria-hidden>
        🔒
      </p>
      <h1 className="mt-2 text-xl font-bold text-brand-dark">Not available for your account</h1>
      <p className="mt-2 text-sm text-gray-600">
        {user ? `${ROLE_LABEL[user.role] ?? user.role} accounts` : 'Your account'} do not have
        access to this area. If you think this is wrong, contact support.
      </p>
      <Link to="/" className="btn mt-4">
        Back to dashboard
      </Link>
    </div>
  );
}
