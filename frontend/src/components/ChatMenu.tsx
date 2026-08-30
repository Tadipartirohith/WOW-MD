import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';

const REASONS: { value: string; label: string }[] = [
  { value: 'harassment', label: 'Harassment or threats' },
  { value: 'fake_profile', label: 'This is not who they say they are' },
  { value: 'asking_for_money', label: 'Asking for money' },
  { value: 'abusive_language', label: 'Abusive language' },
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'other', label: 'Something else' },
];

/**
 * The three-dot menu on a conversation.
 *
 * Blocking and reporting are the two that matter and the two people look for
 * when something has gone wrong, so they are not buried: the rest of the menu
 * is convenience, and convenience can wait behind a scroll.
 *
 * Reporting blocks as well. Somebody who reports harassment almost never wants
 * to keep receiving it while an investigator gets to the queue, and making them
 * find a second control afterwards is asking them to do it twice.
 */
export default function ChatMenu({
  withUserId,
  displayName,
  onClose,
}: {
  withUserId: string;
  displayName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [view, setView] = useState<'menu' | 'report' | 'search'>('menu');
  const [reason, setReason] = useState('harassment');
  const [detail, setDetail] = useState('');
  const [term, setTerm] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const { data: blockState } = useQuery<{ blocked: boolean; since: string | null }>({
    queryKey: ['chat-block', withUserId],
    queryFn: async () =>
      (await api.get('/chat/block', { params: { withUserId } })).data,
    retry: false,
  });

  // Searching starts once there is enough to search for. One character matches
  // most of the conversation and tells nobody anything.
  const { data: results } = useQuery<{ id: string; body: string; createdAt: string }[]>({
    queryKey: ['chat-search', withUserId, term],
    queryFn: async () =>
      (await api.get('/chat/search', { params: { withUserId, term: term.trim() } })).data,
    enabled: view === 'search' && term.trim().length >= 2,
    retry: false,
  });

  const muted = Boolean(
    (
      qc.getQueryData<{ withUserId: string; muted?: boolean }[]>(['conversations']) ?? []
    ).find((c) => c.withUserId === withUserId)?.muted,
  );

  const mute = useMutation({
    mutationFn: async (next: boolean) =>
      (await api.put('/chat/mute', { withUserId, muted: next })).data,
    onSuccess: (_d, next) => {
      setNotice(next ? 'Muted. Messages still arrive; they will not interrupt you.' : 'Unmuted.');
      refresh();
    },
    onError: (err) => setError(apiMessage(err)),
  });

  const clear = useMutation({
    mutationFn: async () => (await api.put('/chat/clear', { withUserId })).data,
    onSuccess: () => {
      setNotice('Emptied for you. Their copy is untouched.');
      void qc.invalidateQueries({ queryKey: ['messages', withUserId] });
      refresh();
    },
    onError: (err) => setError(apiMessage(err)),
  });

  const remove = useMutation({
    mutationFn: async () => (await api.put('/chat/delete-conversation', { withUserId })).data,
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: (err) => setError(apiMessage(err)),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['chat-block', withUserId] });
    void qc.invalidateQueries({ queryKey: ['conversations'] });
    void qc.invalidateQueries({ queryKey: ['messages', withUserId] });
  };

  const block = useMutation({
    mutationFn: async () => (await api.post('/chat/block', { userId: withUserId })).data,
    onSuccess: () => {
      setNotice(`${displayName} can no longer message you.`);
      refresh();
    },
    onError: (err) => setError(apiMessage(err, 'That did not work.')),
  });

  const unblock = useMutation({
    mutationFn: async () => (await api.delete(`/chat/block/${withUserId}`)).data,
    onSuccess: () => {
      setNotice('Unblocked.');
      refresh();
    },
    onError: (err) => setError(apiMessage(err, 'That did not work.')),
  });

  const report = useMutation({
    mutationFn: async () =>
      (await api.post('/chat/report', { userId: withUserId, reason, detail: detail || undefined }))
        .data,
    onSuccess: () => {
      setView('menu');
      setNotice('Reported. Somebody will look at it, and they can no longer message you.');
      refresh();
    },
    onError: (err) => setError(apiMessage(err, 'That report did not go through.')),
  });

  return (
    <div className="absolute right-0 z-30 mt-1 w-72 rounded border border-gray-200 bg-surface p-2 shadow-lg">
      {error && <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-600">{error}</p>}
      {notice && <p className="mb-2 rounded bg-emerald-50 p-2 text-xs text-emerald-700">{notice}</p>}

      {view === 'menu' && (
        <div className="space-y-1 text-sm">
          <MenuItem onClick={() => setView('search')}>Search in conversation</MenuItem>

          {/* Yours alone: the thread still receives messages, it just stops
              interrupting you. */}
          <MenuItem onClick={() => mute.mutate(!muted)}>
            {muted ? 'Unmute notifications' : 'Mute notifications'}
          </MenuItem>

          <MenuItem
            onClick={() => {
              // Says what it actually does. "Clear chat" reads like a delete,
              // and somebody who thinks they have destroyed a record they have
              // only hidden has been misled by the button.
              if (
                !window.confirm(
                  `Empty this conversation for you? ${displayName} keeps their copy, and the messages stay available if anything is ever reported.`,
                )
              ) {
                return;
              }
              clear.mutate();
            }}
          >
            Clear chat
          </MenuItem>

          <MenuItem
            onClick={() => {
              if (
                !window.confirm(
                  `Remove this conversation from your list? It comes back, empty, if ${displayName} messages you again.`,
                )
              ) {
                return;
              }
              remove.mutate();
            }}
          >
            Delete conversation
          </MenuItem>

          <div className="my-1 border-t" />

          {blockState?.blocked ? (
            <>
              <p className="px-2 py-1 text-xs text-gray-500">
                You blocked {displayName}. They cannot message you and are not told why.
              </p>
              <MenuItem onClick={() => unblock.mutate()}>Unblock {displayName}</MenuItem>
            </>
          ) : (
            <MenuItem onClick={() => block.mutate()}>Block {displayName}</MenuItem>
          )}

          <MenuItem danger onClick={() => setView('report')}>
            Report {displayName}
          </MenuItem>

          <div className="my-1 border-t" />
          <MenuItem onClick={onClose}>Close</MenuItem>
        </div>
      )}

      {view === 'search' && (
        <div className="space-y-2">
          <input
            className="input text-sm"
            autoFocus
            placeholder="Find a word or phrase"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          {term.trim().length === 1 && (
            <p className="text-xs text-gray-500">Two characters or more.</p>
          )}
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {(results ?? []).map((m) => (
              <div key={m.id} className="rounded bg-gray-50 p-2 text-xs text-gray-700">
                <p className="line-clamp-3">{m.body}</p>
                <p className="mt-0.5 text-[10px] text-gray-400">
                  {new Date(m.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
            {term.trim().length >= 2 && results && results.length === 0 && (
              <p className="text-xs text-gray-500">Nothing matches in this conversation.</p>
            )}
          </div>
          <button type="button" className="btn-outline text-sm" onClick={() => setView('menu')}>
            Back
          </button>
        </div>
      )}

      {view === 'report' && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            report.mutate();
          }}
        >
          <p className="text-sm font-medium text-gray-900">What has happened?</p>
          <select
            className="input text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <textarea
            className="input text-sm"
            rows={3}
            placeholder="Anything you want to add (optional)"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
          />
          <p className="text-xs text-gray-500">
            The recent messages in this conversation are included so somebody can see what
            happened. {displayName} will also be blocked.
          </p>
          <div className="flex gap-2">
            <button className="btn text-sm" disabled={report.isPending}>
              {report.isPending ? 'Sending…' : 'Send report'}
            </button>
            <button type="button" className="btn-outline text-sm" onClick={() => setView('menu')}>
              Back
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`block w-full rounded px-2 py-1.5 text-left hover:bg-gray-50 ${
        danger ? 'text-red-600' : 'text-gray-700'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
