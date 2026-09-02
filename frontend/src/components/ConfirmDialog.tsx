import { useEffect } from 'react';

/**
 * Asks before something that cannot be taken back.
 *
 * Cancelling a booking went through on the first click, with a provider's held
 * date released and escrow unwound before anybody could think better of it.
 * The dialog is not friction for its own sake — it is the only thing between a
 * misplaced click and a wedding losing its caterer.
 *
 * The confirming button is not the default focus and is not styled as the easy
 * one. Somebody who opened this by accident should be able to press Escape or
 * hit the obvious button and be where they were.
 */
export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Keep it',
  tone = 'critical',
  busy = false,
  onConfirm,
  onDismiss,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'critical' | 'normal';
  busy?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={onDismiss}
    >
      <div
        className="card w-full max-w-sm"
        // The backdrop dismisses; the card must not, or every click inside it
        // would close the thing the person is reading.
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="section-title">
          {title}
        </h2>
        <p className="mt-1 text-sm text-gray-600">{body}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button className="btn-outline" onClick={onDismiss} autoFocus disabled={busy}>
            {cancelLabel}
          </button>
          <button
            className={tone === 'critical' ? 'btn bg-critical-fg hover:bg-critical-fg' : 'btn'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
