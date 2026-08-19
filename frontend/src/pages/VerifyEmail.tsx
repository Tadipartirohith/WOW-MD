import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';

export default function VerifyEmail() {
  const { token = '' } = useParams();
  const setUser = useAuth((s) => s.setUser);
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .post('/auth/verify-email', { token })
      .then(() => {
        if (cancelled) return;
        setState('done');
        // Reflect it immediately if this tab is already signed in.
        setUser({ isVerified: true });
      })
      .catch((err) => {
        if (cancelled) return;
        setState('failed');
        setMessage(apiMessage(err, 'That verification link is invalid or has expired.'));
      });
    return () => {
      cancelled = true;
    };
  }, [token, setUser]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-md text-center">
        {state === 'working' && <p className="text-gray-500">Confirming your email...</p>}
        {state === 'done' && (
          <>
            <p className="text-4xl" aria-hidden>
              &#9989;
            </p>
            <h1 className="mt-2 text-xl font-bold text-brand-dark">Email confirmed</h1>
            <p className="mt-2 text-sm text-gray-600">Thank you, your account is fully set up.</p>
          </>
        )}
        {state === 'failed' && (
          <>
            <p className="text-4xl" aria-hidden>
              &#9888;
            </p>
            <h1 className="mt-2 text-xl font-bold text-brand-dark">We could not confirm that</h1>
            <p className="mt-2 text-sm text-gray-600">{message}</p>
          </>
        )}
        <Link to="/" className="btn mt-4">
          Continue
        </Link>
      </div>
    </div>
  );
}
