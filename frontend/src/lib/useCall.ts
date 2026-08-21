import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../store/auth';

export type CallState = 'idle' | 'ringing' | 'incoming' | 'connecting' | 'active' | 'ended';

export interface IncomingCall {
  fromUserId: string;
  sdp: string;
  media: 'audio' | 'video';
}

interface Signal {
  fromUserId: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  reason?: string;
}

const API_ORIGIN = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api').replace(
  /\/api\/?$/,
  '',
);

/**
 * Voice and video between two people who have matched.
 *
 * The media never touches our server: the two browsers negotiate through the
 * socket and then talk directly. That is the only way calling is affordable —
 * a relay carrying every call's audio is a bandwidth bill that grows with usage
 * rather than with revenue.
 *
 * The consequence is that some calls will not connect. Roughly one network in
 * ten sits behind a NAT that peer-to-peer cannot traverse, and those need a
 * TURN relay, which costs money precisely because it does carry the audio. The
 * server hands its ICE configuration back on the offer, so adding TURN later is
 * a deployment change and nothing here has to move. Until then, `failed` is
 * reported plainly rather than leaving somebody staring at a connecting screen.
 */
export function useCall() {
  const token = useAuth((s) => s.accessToken);

  const [state, setState] = useState<CallState>('idle');
  const [peerId, setPeerId] = useState<string | null>(null);
  const [media, setMedia] = useState<'audio' | 'video'>('audio');
  const [error, setError] = useState('');
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);

  const socket = useRef<Socket | null>(null);
  const connection = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const remoteStream = useRef<MediaStream | null>(null);
  const iceServers = useRef<RTCIceServer[]>([]);
  // Candidates can arrive before the remote description is set, and adding one
  // then throws. They are queued and flushed once there is something to add
  // them to.
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);

  const teardown = useCallback(() => {
    connection.current?.close();
    connection.current = null;
    localStream.current?.getTracks().forEach((track) => track.stop());
    localStream.current = null;
    remoteStream.current = null;
    pendingCandidates.current = [];
    setPeerId(null);
    setIncoming(null);
  }, []);

  // One socket for the session. Reconnecting per call would mean the first
  // ring arriving before the listener exists.
  useEffect(() => {
    if (!token) return undefined;

    const client = io(`${API_ORIGIN}/chat`, {
      auth: { token },
      transports: ['websocket'],
    });
    socket.current = client;

    client.on('call:incoming', (payload: IncomingCall) => {
      // One call at a time. A second ring while you are already talking is
      // dropped rather than stacking two audio streams on top of each other.
      if (connection.current) {
        client.emit('call:end', { toUserId: payload.fromUserId, reason: 'busy' });
        return;
      }
      setIncoming(payload);
      setPeerId(payload.fromUserId);
      setMedia(payload.media);
      setState('incoming');
    });

    client.on('call:answered', async ({ sdp }: Signal) => {
      if (!connection.current || !sdp) return;
      await connection.current.setRemoteDescription({ type: 'answer', sdp });
      await flushCandidates();
      setState('connecting');
    });

    client.on('call:candidate', async ({ candidate }: Signal) => {
      if (!candidate) return;
      if (!connection.current?.remoteDescription) {
        pendingCandidates.current.push(candidate);
        return;
      }
      await connection.current.addIceCandidate(candidate).catch(() => undefined);
    });

    client.on('call:ended', ({ reason }: Signal) => {
      setError(reason === 'busy' ? 'They are already on a call.' : '');
      teardown();
      setState('ended');
    });

    return () => {
      client.close();
      socket.current = null;
      teardown();
    };
  }, [token, teardown]);

  async function flushCandidates() {
    const queued = pendingCandidates.current;
    pendingCandidates.current = [];
    for (const candidate of queued) {
      await connection.current?.addIceCandidate(candidate).catch(() => undefined);
    }
  }

  /** Builds the peer connection and wires its events to state. */
  function createConnection(toUserId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: iceServers.current });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.current?.emit('call:candidate', { toUserId, candidate: event.candidate.toJSON() });
      }
    };

    pc.ontrack = (event) => {
      remoteStream.current = event.streams[0];
      setState('active');
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setState('active');
      if (pc.connectionState === 'failed') {
        // Almost always a NAT that peer-to-peer cannot cross. Saying so is more
        // use than a spinner that never resolves.
        setError('The call could not connect on this network. Try messaging instead.');
        teardown();
        setState('ended');
      }
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
        teardown();
        setState('ended');
      }
    };

    connection.current = pc;
    return pc;
  }

  async function capture(kind: 'audio' | 'video'): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: kind === 'video',
    });
    localStream.current = stream;
    return stream;
  }

  /** Ring somebody. */
  const call = useCallback(
    async (toUserId: string, kind: 'audio' | 'video' = 'audio') => {
      setError('');
      setMedia(kind);
      setPeerId(toUserId);
      setState('ringing');

      try {
        const stream = await capture(kind);
        const pc = createConnection(toUserId);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const reply = await socket.current?.emitWithAck('call:offer', {
          toUserId,
          sdp: offer.sdp,
          media: kind,
        });

        if (reply?.error) {
          setError(reply.reason ?? reply.error);
          teardown();
          setState('ended');
          return;
        }
        if (reply?.iceServers) iceServers.current = reply.iceServers;
      } catch (err) {
        // Overwhelmingly a declined microphone permission, which is worth
        // naming rather than reporting as a failed call.
        setError(
          (err as Error).name === 'NotAllowedError'
            ? 'Your browser blocked access to the microphone.'
            : 'That call could not be started.',
        );
        teardown();
        setState('ended');
      }
    },
    [teardown],
  );

  /** Pick up. */
  const answer = useCallback(async () => {
    if (!incoming) return;
    setError('');
    setState('connecting');

    try {
      const stream = await capture(incoming.media);
      const pc = createConnection(incoming.fromUserId);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      await pc.setRemoteDescription({ type: 'offer', sdp: incoming.sdp });
      await flushCandidates();

      const answerSdp = await pc.createAnswer();
      await pc.setLocalDescription(answerSdp);

      const reply = await socket.current?.emitWithAck('call:answer', {
        toUserId: incoming.fromUserId,
        sdp: answerSdp.sdp,
      });
      if (reply?.iceServers) iceServers.current = reply.iceServers;

      setIncoming(null);
    } catch (err) {
      setError(
        (err as Error).name === 'NotAllowedError'
          ? 'Your browser blocked access to the microphone.'
          : 'That call could not be answered.',
      );
      teardown();
      setState('ended');
    }
  }, [incoming, teardown]);

  /** Hang up, or decline. */
  const hangUp = useCallback(
    (reason = 'ended') => {
      const other = peerId ?? incoming?.fromUserId;
      if (other) socket.current?.emit('call:end', { toUserId: other, reason });
      teardown();
      setState('idle');
    },
    [peerId, incoming, teardown],
  );

  return {
    state,
    media,
    error,
    peerId,
    incoming,
    call,
    answer,
    hangUp,
    localStream: localStream.current,
    remoteStream: remoteStream.current,
  };
}
