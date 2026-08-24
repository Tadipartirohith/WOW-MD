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
  const [view, setView] = useState<'menu' | 'report'>('menu');
  const [reason, setReason] = useState('harassment');
  const [detail, setDetail] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const { data: blockState } = useQuery<{ blocked: boolean; since: string | null }>({
    queryKey: ['chat-block', withUserId],
    queryFn: async () =>
      (await api.get('/chat/block', { params: { withUserId } })).data,
    retry: false,
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
    <div className="absolute right-0 z-30 mt-1 w-72 rounded border border-gray-200 bg-white p-2 shadow-lg">
      {error && <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-600">{error}</p>}
      {notice && <p className="mb-2 rounded bg-emerald-50 p-2 text-xs text-emerald-700">{notice}</p>}

      {view === 'menu' && (
        <div className="space-y-1 text-sm">
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
