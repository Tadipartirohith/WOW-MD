import { useEffect, useRef } from 'react';
import { CallState } from '../lib/useCall';

/**
 * The call itself.
 *
 * Deliberately a small overlay rather than a full screen: on a phone the person
 * is usually still reading the conversation while it rings, and taking the
 * whole screen away to show a spinner helps nobody.
 */
export default function CallPanel({
  state,
  media,
  error,
  withName,
  localStream,
  remoteStream,
  onAnswer,
  onHangUp,
}: {
  state: CallState;
  media: 'audio' | 'video';
  error: string;
  withName: string;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onAnswer: () => void;
  onHangUp: (reason?: string) => void;
}) {
  const remoteRef = useRef<HTMLVideoElement>(null);
  const localRef = useRef<HTMLVideoElement>(null);

  // Streams are attached imperatively; React has no prop for a MediaStream, and
  // setting src on a re-render would restart playback mid-call.
  useEffect(() => {
    if (remoteRef.current && remoteStream) remoteRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    if (localRef.current && localStream) localRef.current.srcObject = localStream;
  }, [localStream]);

  if (state === 'idle') return null;

  const label: Record<CallState, string> = {
    idle: '',
    ringing: `Ringing ${withName}…`,
    incoming: `${withName} is calling`,
    connecting: 'Connecting…',
    active: `On a call with ${withName}`,
    ended: error ? 'Call ended' : `Call with ${withName} ended`,
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-lg border border-gray-200 bg-surface p-4 shadow-pop">
      <p className="font-medium text-gray-900">{label[state]}</p>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}

      {media === 'video' && state === 'active' && (
        <div className="relative mt-3">
          <video ref={remoteRef} autoPlay playsInline className="w-full rounded-sm bg-black" />
          <video
            ref={localRef}
            autoPlay
            playsInline
            muted
            className="absolute bottom-2 right-2 w-20 rounded-sm border border-white/60"
          />
        </div>
      )}

      {media === 'audio' && (
        // Audio still needs an element to play through; it is simply not shown.
        <video ref={remoteRef} autoPlay playsInline className="hidden" />
      )}

      <div className="mt-3 flex gap-2">
        {state === 'incoming' && (
          <button className="btn flex-1" onClick={onAnswer}>
            Answer
          </button>
        )}
        {state === 'ended' ? (
          <button className="btn-outline flex-1" onClick={() => onHangUp('ended')}>
            Close
          </button>
        ) : (
          <button
            className="btn-outline flex-1 text-red-600"
            onClick={() => onHangUp(state === 'incoming' ? 'declined' : 'ended')}
          >
            {state === 'incoming' ? 'Decline' : 'Hang up'}
          </button>
        )}
      </div>
    </div>
  );
}
