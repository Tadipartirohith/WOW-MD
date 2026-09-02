import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { LinkSimple, WhatsappLogo } from '@phosphor-icons/react';
import { api, apiMessage } from '../lib/api';

/**
 * One link for a day, to put in a family group.
 *
 * Inviting somebody used to mean entering them as a guest first — name,
 * contact, the lot — and then sending a token addressed to that row. That is
 * the right shape for a list you already hold, and the wrong one for a
 * wedding, where the invitation goes into a group chat and the host finds out
 * who is coming from the replies.
 *
 * The token is shown once, here, because that is the only moment the server
 * has it in plain text — it is stored hashed, so nobody can recover it later,
 * including us. Generating a new one is how a link that went somewhere it
 * should not have is withdrawn.
 */
export default function ShareInvitation({ eventId, eventName }: { eventId: string; eventName: string }) {
  const [token, setToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const link = token ? `${window.location.origin}/invitation/${token}` : '';

  const mint = useMutation({
    mutationFn: async () => (await api.post(`/events/${eventId}/share-link`, {})).data,
    onSuccess: (d: { token: string }) => {
      setToken(d.token);
      setError('');
    },
    onError: (e) => setError(apiMessage(e, 'The link could not be created.')),
  });

  const revoke = useMutation({
    mutationFn: async () => api.delete(`/events/${eventId}/share-link`),
    onSuccess: () => {
      setToken('');
      setError('');
    },
    onError: (e) => setError(apiMessage(e, 'The link could not be withdrawn.')),
  });

  return (
    <div className="space-y-2">
      {error && <p className="alert-critical">{error}</p>}

      {!token ? (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-outline" disabled={mint.isPending} onClick={() => mint.mutate()}>
            {mint.isPending ? 'Creating…' : 'Share invitation'}
          </button>
          <p className="text-xs text-gray-500">
            One link anybody can open and answer. You do not have to add guests first.
          </p>
        </div>
      ) : (
        <div className="space-y-2 rounded-sm border border-gray-200 bg-surface-sunken p-3">
          <p className="text-sm font-medium text-gray-800">The invitation link</p>
          <div className="flex flex-wrap items-center gap-2">
            <input className="input min-w-0 flex-1 font-mono text-xs" readOnly value={link} />
            <button
              className="btn-outline btn-sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                } catch {
                  // Clipboard access is refused in some browsers and over
                  // plain HTTP. The field beside this is readable and
                  // selectable, so there is still a way through.
                  setError('Copying was blocked. Select the link above instead.');
                }
              }}
            >
              <LinkSimple size={14} aria-hidden />
              {copied ? 'Copied' : 'Copy'}
            </button>
            <a
              className="btn-outline btn-sm"
              href={`https://wa.me/?text=${encodeURIComponent(
                `You are invited to ${eventName}. Please let us know if you can come: ${link}`,
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              <WhatsappLogo size={14} aria-hidden />
              WhatsApp
            </a>
          </div>
          <p className="text-xs text-gray-500">
            Anybody with this link can reply, and their reply adds them to your guest list. Save
            it somewhere — it is stored scrambled, so it cannot be shown again.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-ghost btn-sm -ml-2"
              disabled={mint.isPending}
              onClick={() => mint.mutate()}
            >
              Replace with a new link
            </button>
            <button
              className="btn-ghost btn-sm text-critical-fg"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate()}
            >
              Withdraw it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
