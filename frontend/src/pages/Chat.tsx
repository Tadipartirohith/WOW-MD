import { FormEvent, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import { useCall } from '../lib/useCall';
import CallPanel from '../components/CallPanel';
import ChatMenu from '../components/ChatMenu';
import ProfilePreview from '../components/ProfilePreview';
import { Loading } from '../components/ui/Feedback';

/**
 * A time a reader can scan.
 *
 * Today gets a clock, this week gets a weekday, anything older gets a date.
 * A full timestamp on every row is four rows of noise for one row of use.
 */
function shortTime(iso: string): string {
  const then = new Date(iso);
  const days = (Date.now() - then.getTime()) / 86_400_000;
  if (days < 1) return then.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (days < 7) return then.toLocaleDateString([], { weekday: 'short' });
  return then.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

interface Conversation {
  conversationId: string;
  withUserId: string;
  displayName: string;
  photoUrl: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastMessageMine: boolean;
  lastMessageRead: boolean;
  unread: number;
  online: boolean;
  profileId: string | null;
  profileCode: string | null;
  ageRange: string | null;
  city: string | null;
  lastActiveAt: string | null;
  /** Why these two are talking: the accepted interest, and how it scored. */
  context: { interestId: string; score: number | null; standing: 'accepted' | 'fixed' } | null;
  /**
   * Why this thread is allowed to exist. A 'match' cannot be used until the
   * interest is accepted (which is exactly when `context` appears), so the
   * composer and call controls stay locked until then. Inquiry and
   * representation threads carry no such gate.
   */
  kind: 'match' | 'inquiry' | 'representation' | null;
}

interface Message {
  id: string;
  senderId: string;
  body: string;
  redactedCount: number;
  createdAt: string;
  readAt: string | null;
}

/**
 * The other kind of thread: the two people *handling* a possible match talking
 * to each other, which in this market is where most of the negotiation happens.
 *
 * It is a genuinely different conversation from the couple's, between different
 * people, and it hangs off an interest rather than a pair of accounts. It is
 * listed here rather than merged into the same store: an agency's working
 * thread about a family is not the family's own chat, and quietly folding one
 * into the other would put things in front of people who were never party to
 * them.
 */
interface ProposalThread {
  interestId: string;
  status: string;
  otherName: string;
  otherPhotoUrl: string | null;
  lastNote: string | null;
  lastNoteAt: string | null;
  lastNoteMine: boolean;
  noteCount: number;
}

interface ProposalDetail {
  interestId: string;
  status: string;
  sides: { profile: { displayName: string }; handledBy: string | null; isMine: boolean }[];
  notes: { id: string; body: string; mine: boolean; createdAt: string }[];
}

/**
 * Messages.
 *
 * The conversation list is the screen, not a dropdown of user ids. Picking a
 * row opens that thread — which is the whole point and, until now, the thing
 * that did not happen: the picker wrote the same id into state whichever way
 * the match ran, so half of all matches opened a conversation with yourself.
 */
export default function Chat() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [withUserId, setWithUserId] = useState(params.get('with') ?? '');
  // Exactly one thread is open at a time, of either kind.
  const [interestId, setInterestId] = useState(params.get('proposal') ?? '');
  const [menuOpen, setMenuOpen] = useState(false);
  // Which profile is open over the thread, if any.
  const [previewId, setPreviewId] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  const { data: conversations = [], isLoading } = useQuery<Conversation[]>({
    queryKey: ['conversations'],
    queryFn: async () => (await api.get('/chat/conversations')).data,
    refetchInterval: 15_000,
  });

  // Agents were opening this page, finding "No conversations yet", and going
  // back to Proposals — because their threads live in a different store and
  // this list never asked for them.
  const { data: proposals = [] } = useQuery<ProposalThread[]>({
    queryKey: ['proposal-threads'],
    queryFn: async () => (await api.get('/circulation/proposals')).data,
    refetchInterval: 15_000,
    retry: false,
  });

  const { data: proposal } = useQuery<ProposalDetail>({
    queryKey: ['proposal-thread', interestId],
    queryFn: async () => (await api.get(`/circulation/proposals/${interestId}`)).data,
    enabled: Boolean(interestId),
    refetchInterval: 15_000,
  });

  const { data: history } = useQuery({
    queryKey: ['history', withUserId],
    queryFn: async () => (await api.get('/chat/messages', { params: { withUserId } })).data,
    enabled: Boolean(withUserId),
    refetchInterval: 4000,
  });

  const { data: presence } = useQuery({
    queryKey: ['presence', withUserId],
    queryFn: async () => (await api.get('/chat/presence', { params: { withUserId } })).data,
    enabled: Boolean(withUserId),
    refetchInterval: 30_000,
  });

  const call = useCall();
  const messages: Message[] = [...(history?.data ?? [])].reverse();
  const active = conversations.find((c) => c.withUserId === withUserId);
  // Locked by default (EZ1-I155). The composer opens only for a thread we can
  // positively confirm is talkable: an inquiry or representation thread, or a
  // match whose interest is accepted — which is exactly when `context` appears.
  // A thread the conversation list does not carry (a `?with=` deep link, or a
  // not-yet-accepted match) leaves `active` undefined and therefore stays
  // locked, so the UI is never an open composer the server would refuse. Any
  // genuinely accepted match is already in the list (as a row or a silent
  // pending match), so this only locks what should be locked.
  const openable =
    active?.kind === 'inquiry' ||
    active?.kind === 'representation' ||
    Boolean(active?.context);
  const locked = !openable;

  // Opening a thread clears its badge, and the URL carries the selection so a
  // notification can link straight into a conversation.
  useEffect(() => {
    if (!withUserId) return;
    setParams({ with: withUserId }, { replace: true });
    api
      .put('/chat/messages/read', {}, { params: { withUserId } })
      .then(() => qc.invalidateQueries({ queryKey: ['conversations'] }))
      .catch(() => undefined);
  }, [withUserId, setParams, qc]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!withUserId || !body.trim()) return;
    setError('');
    try {
      await api.post('/chat/messages', { toUserId: withUserId, body });
      setBody('');
      qc.invalidateQueries({ queryKey: ['history', withUserId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    } catch (err) {
      setError(apiMessage(err, 'That message was not sent.'));
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Messages</h1>
        <p className="page-subtitle">
          Every conversation you are part of: direct messages, and the proposal threads you are
          handling. Phone numbers and email addresses are removed from direct messages before they
          are stored. Keep the conversation here until you are both ready.
        </p>
      </div>

      {error && <p className="alert-critical">{error}</p>}

      {previewId && <ProfilePreview profileId={previewId} onClose={() => setPreviewId('')} />}

      <div className="grid gap-4 md:grid-cols-[18rem,1fr]">
        <div className="card max-h-[32rem] overflow-y-auto p-0">
          {isLoading && <div className="p-4">
          <Loading rows={2} />
        </div>}
          {!isLoading && conversations.length === 0 && proposals.length === 0 && (
            <p className="p-4 text-sm text-gray-400">
              No conversations yet. They start when an interest is accepted, or when you message a
              vendor.
            </p>
          )}
          {conversations.length > 0 && proposals.length > 0 && (
            <p className="border-b border-gray-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Direct
            </p>
          )}
          {conversations.map((c) => (
            <button
              key={c.withUserId}
              onClick={() => {
                setWithUserId(c.withUserId);
                setInterestId('');
                setMenuOpen(false);
              }}
              className={`flex w-full items-start gap-3 border-b border-gray-100 p-3 text-left ${
                withUserId === c.withUserId ? 'bg-brand-light' : 'hover:bg-gray-50'
              }`}
            >
              <span className="relative shrink-0">
                {c.photoUrl ? (
                  <img src={c.photoUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 text-sm text-gray-600">
                    {c.displayName.slice(0, 1).toUpperCase()}
                  </span>
                )}
                {c.online && (
                  <span
                    className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500"
                    title="Online now"
                  />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-gray-900">
                    {c.displayName}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {c.lastMessageAt && (
                      <span className="text-[10px] text-gray-400">{shortTime(c.lastMessageAt)}</span>
                    )}
                    {c.unread > 0 && (
                      <span className="rounded-full bg-brand px-1.5 text-xs font-semibold text-brand-fg">
                        {c.unread}
                      </span>
                    )}
                  </span>
                </span>
                {/*
                  The code and the town, under the name.

                  Two people called Pardhu in one list was the reported
                  problem, and a name on its own cannot solve it. The profile
                  code is unique and the town is what a reader actually uses to
                  tell them apart without thinking about it.
                */}
                <span className="block truncate text-[11px] text-gray-400">
                  {[c.profileCode, c.ageRange ? `${c.ageRange} yrs` : null, c.city]
                    .filter(Boolean)
                    .join(' \u00b7 ')}
                </span>
                <span className="block truncate text-xs text-gray-500">
                  {c.lastMessage
                    ? `${c.lastMessageMine ? (c.lastMessageRead ? '\u2713\u2713 ' : '\u2713 ') : ''}${c.lastMessage}`
                    : 'No messages yet'}
                </span>
              </span>
            </button>
          ))}

          {proposals.length > 0 && (
            <p className="border-b border-gray-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Proposals
            </p>
          )}
          {proposals.map((t) => (
            <button
              key={t.interestId}
              onClick={() => {
                setInterestId(t.interestId);
                setWithUserId('');
              }}
              className={`flex w-full items-start gap-3 border-b border-gray-100 p-3 text-left ${
                interestId === t.interestId ? 'bg-brand-light' : 'hover:bg-gray-50'
              }`}
            >
              <span className="shrink-0">
                {t.otherPhotoUrl ? (
                  <img
                    src={t.otherPhotoUrl}
                    alt=""
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 text-sm text-gray-600">
                    {t.otherName.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-gray-900">{t.otherName}</span>
                  {/*
                    There is no read state on a proposal note, so an unread
                    count here would be invented. "They spoke last" is the
                    honest version of the same signal.
                  */}
                  {t.lastNote && !t.lastNoteMine && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-xs font-medium text-amber-800">
                      reply
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-gray-500">
                  {t.lastNote
                    ? `${t.lastNoteMine ? 'You: ' : ''}${t.lastNote}`
                    : 'No notes yet'}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="card flex min-h-[24rem] flex-col">
          {!withUserId && !interestId && (
            <p className="m-auto text-sm text-gray-400">Pick a conversation to open it.</p>
          )}

          {interestId && proposal && (
            <ProposalPane
              thread={proposal}
              onPosted={() => {
                void qc.invalidateQueries({ queryKey: ['proposal-thread', interestId] });
                void qc.invalidateQueries({ queryKey: ['proposal-threads'] });
              }}
              onError={setError}
            />
          )}

          {withUserId && !interestId && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                <div className="flex min-w-0 items-center gap-3">
                  {active?.photoUrl ? (
                    <img
                      src={active.photoUrl}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-200 text-sm text-gray-600">
                      {(active?.displayName ?? '?').slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-gray-900">
                      {active?.displayName ?? 'Conversation'}
                    </p>
                    {/*
                      Who this is, on one line. The header said a name and an
                      online dot, which is not enough to know which of several
                      conversations you have opened.
                    */}
                    <p className="truncate text-xs text-gray-500">
                      {[
                        active?.profileCode,
                        active?.ageRange ? `${active.ageRange} yrs` : null,
                        active?.city,
                      ]
                        .filter(Boolean)
                        .join(' \u00b7 ')}
                    </p>
                    <p className="text-xs text-gray-500">
                      {presence?.online
                        ? 'Online now'
                        : presence?.lastSeen
                          ? `Last seen ${new Date(presence.lastSeen).toLocaleString()}`
                          : 'Offline'}
                      {active?.context && (
                        <span className="ml-2 rounded-full bg-brand-light px-2 py-0.5 text-brand-dark">
                          {active.context.score !== null && `${active.context.score}% match \u00b7 `}
                          {active.context.standing === 'fixed' ? 'Match fixed' : 'Interest accepted'}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                {/* Only when they are actually there: a call to somebody
                    offline can only ring out, which teaches people the button
                    does not work. */}
                <div className="flex items-center gap-2">
                  {/*
                    Straight to the profile, from the conversation about it.
                    Going back to Matches and finding them again was the only
                    route, and by then the reason for looking is gone.
                  */}
                  {active?.profileId && (
                    <button
                      className="btn-outline text-xs"
                      onClick={() => setPreviewId(active.profileId as string)}
                    >
                      View profile
                    </button>
                  )}
                  {/*
                    Calling is offered only once the interest is accepted
                    (EZ1-I125): `context` is present exactly for an accepted or
                    fixed match, and absent for a proposal that has not been
                    accepted, so the audio/video controls stay locked until then.
                    When shown they are always enabled — a call to somebody
                    offline is answered with "they are not online right now"
                    rather than a greyed-out button (EZ1-I38, EZ1-I89).
                  */}
                  {call.state === 'idle' && active?.context && (
                    <>
                      {/* Always enabled (EZ1-I38, EZ1-I89): a call to somebody
                          offline is answered by the server with "they are not
                          online right now" and resets cleanly, which is a clearer
                          answer than a permanently greyed-out button that reads
                          as "calling isn't built". */}
                      <button
                        className="btn-outline text-xs"
                        title={
                          presence?.online
                            ? 'Audio call, in the app, no number is exchanged'
                            : 'Audio call — connects when they are also in the app'
                        }
                        onClick={() => call.call(withUserId, 'audio')}
                      >
                        Call
                      </button>
                      <button
                        className="btn-outline text-xs"
                        title={
                          presence?.online
                            ? 'Video call, in the app'
                            : 'Video call — connects when they are also in the app'
                        }
                        onClick={() => call.call(withUserId, 'video')}
                      >
                        Video
                      </button>
                    </>
                  )}
                  {/*
                    The reason, on screen rather than in a title attribute.

                    Both buttons were reported as simply disabled, and they are
                    — correctly, because calls run between two people who are
                    both here. But the explanation lived in a tooltip, which
                    does not exist on a phone and is easy to miss on a laptop,
                    so what a person actually sees is two dead controls. Saying
                    it in the open turns a broken-looking screen into a
                    working one that is waiting for somebody.
                  */}
                  {call.state === 'idle' && !presence?.online && (
                    <span className="text-xs text-gray-500">
                      Calls need you both here. They will light up when they are back.
                    </span>
                  )}
                  {/*
                    Blocking and reporting live here. Not buried: they are what
                    somebody looks for when something has gone wrong, and a
                    control you have to hunt for at that moment is one you do
                    not find.
                  */}
                  <div className="relative">
                    <button
                      className="rounded-sm px-2 py-1 text-lg leading-none text-gray-500 hover:bg-gray-100"
                      aria-label="More options"
                      onClick={() => setMenuOpen(!menuOpen)}
                    >
                      ⋮
                    </button>
                    {menuOpen && (
                      <ChatMenu
                        withUserId={withUserId}
                        displayName={active?.displayName ?? 'this person'}
                        onClose={() => setMenuOpen(false)}
                      />
                    )}
                  </div>
                </div>
              </div>

              <div className="my-3 flex-1 space-y-2 overflow-y-auto">
                {messages.length === 0 && (
                  <p className="text-sm text-gray-400">No messages yet. Say hello.</p>
                )}
                {messages.map((m) => {
                  const mine = m.senderId !== withUserId;
                  return (
                    <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                          mine ? 'bg-brand text-brand-fg' : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <p
                          className={`mt-0.5 text-[10px] ${
                            mine ? 'text-brand-fg/70' : 'text-gray-400'
                          }`}
                        >
                          {new Date(m.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {/*
                            One tick delivered, two read, and only on your own
                            messages — a tick on a message you received says
                            nothing anybody wanted to know.
                          */}
                          {mine && (m.readAt ? ' \u00b7 \u2713\u2713' : ' \u00b7 \u2713')}
                          {m.redactedCount > 0 && ' · contact details removed'}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottom} />
              </div>

              {/*
                A match cannot be talked into until the interest is accepted
                (EZ1-I155). The composer is disabled outright rather than left
                open to fail on send, and the reason is shown in the open — a
                dead input with no explanation reads as a broken screen. Calls
                are gated by the same acceptance above (they need `context`).
              */}
              {locked ? (
                <p className="border-t pt-3 text-sm text-gray-500">
                  Chat opens once the interest is accepted.
                </p>
              ) : (
                <form onSubmit={send} className="flex gap-2 border-t pt-3">
                  <input
                    className="input flex-1"
                    placeholder="Type a message…"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                  <button className="btn" disabled={!body.trim()}>
                    Send
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>

      <CallPanel
        state={call.state}
        media={call.media}
        error={call.error}
        withName={
          conversations.find((c) => c.withUserId === (call.peerId ?? withUserId))?.displayName ??
          'them'
        }
        localStream={call.localStream}
        remoteStream={call.remoteStream}
        onAnswer={call.answer}
        onHangUp={call.hangUp}
      />
    </div>
  );
}

/**
 * The agent-to-agent thread on a pairing.
 *
 * Deliberately plainer than the direct chat: no presence, no calling, no
 * redaction badge. This is two professionals comparing notes about a possible
 * match, and dressing it up as the couple's own conversation would be the same
 * mistake as merging the two stores.
 */
const PROPOSAL_REPORT_REASONS: { value: string; label: string }[] = [
  { value: 'harassment', label: 'Harassment or threats' },
  { value: 'fake_profile', label: 'This is not who they say they are' },
  { value: 'asking_for_money', label: 'Asking for money' },
  { value: 'abusive_language', label: 'Abusive language' },
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'other', label: 'Something else' },
];

function ProposalPane({
  thread,
  onPosted,
  onError,
}: {
  thread: ProposalDetail;
  onPosted: () => void;
  onError: (message: string) => void;
}) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [view, setView] = useState<'menu' | 'report'>('menu');
  const [reason, setReason] = useState('harassment');
  const [detail, setDetail] = useState('');
  const [notice, setNotice] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  const closed = thread.status === 'withdrawn' || thread.status === 'rejected';
  // Messaging opens only once the interest is accepted (EZ1-I130), matching the
  // backend gate — before that there is nothing agreed to talk on.
  const notYetAccepted = thread.status !== 'accepted' && !closed;

  const mine = thread.sides.find((s) => s.isMine);
  const theirs = thread.sides.find((s) => !s.isMine);
  const otherName = theirs?.profile.displayName ?? 'the other side';

  // Whether the other side can be acted on at all: an agency holding both
  // sides has no far side to block or report. Mirrors the backend's refusal.
  const hasOther = Boolean(theirs);

  // Only your own block is ever reported — knowing you have been blocked is the
  // thing this is designed not to tell you.
  const { data: blockState, refetch: refetchBlock } = useQuery<{
    blocked: boolean;
    since: string | null;
  }>({
    queryKey: ['proposal-block', thread.interestId],
    queryFn: async () =>
      (await api.get(`/circulation/proposals/${thread.interestId}/block`)).data,
    enabled: hasOther,
    retry: false,
  });
  const blocked = Boolean(blockState?.blocked);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread.notes.length]);

  async function post(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api.post(`/circulation/proposals/${thread.interestId}/notes`, { body: body.trim() });
      setBody('');
      onPosted();
    } catch (err) {
      onError(apiMessage(err, 'That note was not posted.'));
    } finally {
      setBusy(false);
    }
  }

  async function block() {
    try {
      await api.post(`/circulation/proposals/${thread.interestId}/block`);
      setNotice(`${otherName} can no longer message this proposal.`);
      void refetchBlock();
    } catch (err) {
      onError(apiMessage(err, 'That did not work.'));
    }
  }

  async function unblock() {
    try {
      await api.delete(`/circulation/proposals/${thread.interestId}/block`);
      setNotice('Unblocked.');
      void refetchBlock();
    } catch (err) {
      onError(apiMessage(err, 'That did not work.'));
    }
  }

  async function report(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post(`/circulation/proposals/${thread.interestId}/report`, {
        reason,
        detail: detail || undefined,
      });
      setView('menu');
      setMenuOpen(false);
      setNotice('Reported. Somebody will look at it, and they can no longer message you here.');
      void refetchBlock();
      void qc.invalidateQueries({ queryKey: ['proposal-thread', thread.interestId] });
    } catch (err) {
      onError(apiMessage(err, 'That report did not go through.'));
    }
  }

  return (
    <>
      <div className="flex items-start justify-between gap-2 border-b pb-2">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900">
            {mine?.profile.displayName ?? 'Your side'} &amp;{' '}
            {theirs?.profile.displayName ?? 'the other side'}
          </p>
          <p className="text-xs text-gray-500">
            Between the two people handling this pairing · {thread.status.replace(/_/g, ' ')}
          </p>
        </div>
        {/*
          Report and block live here, where somebody looks when a proposal
          conversation has gone wrong. Only shown when there is a far side to
          act on — an agency handling both sides has nobody to report.
        */}
        {hasOther && (
          <div className="relative shrink-0">
            <button
              className="rounded-sm px-2 py-1 text-lg leading-none text-gray-500 hover:bg-gray-100"
              aria-label="More options"
              onClick={() => {
                setView('menu');
                setMenuOpen((o) => !o);
              }}
            >
              ⋮
            </button>
            {menuOpen && (
              <div className="absolute right-0 z-30 mt-1 w-72 rounded-sm border border-gray-200 bg-surface p-2 shadow-pop">
                {view === 'menu' && (
                  <div className="space-y-1 text-sm">
                    {blocked ? (
                      <>
                        <p className="px-2 py-1 text-xs text-gray-500">
                          You blocked {otherName}. They cannot message this proposal and are not
                          told why.
                        </p>
                        <button
                          type="button"
                          className="block w-full rounded-sm px-2 py-1.5 text-left text-gray-700 hover:bg-gray-50"
                          onClick={() => unblock()}
                        >
                          Unblock {otherName}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="block w-full rounded-sm px-2 py-1.5 text-left text-gray-700 hover:bg-gray-50"
                        onClick={() => block()}
                      >
                        Block {otherName}
                      </button>
                    )}
                    <button
                      type="button"
                      className="block w-full rounded-sm px-2 py-1.5 text-left text-red-600 hover:bg-gray-50"
                      onClick={() => setView('report')}
                    >
                      Report {otherName}
                    </button>
                    <div className="my-1 border-t" />
                    <button
                      type="button"
                      className="block w-full rounded-sm px-2 py-1.5 text-left text-gray-700 hover:bg-gray-50"
                      onClick={() => setMenuOpen(false)}
                    >
                      Close
                    </button>
                  </div>
                )}
                {view === 'report' && (
                  <form className="space-y-2" onSubmit={report}>
                    <p className="text-sm font-medium text-gray-900">What has happened?</p>
                    <select
                      className="input text-sm"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    >
                      {PROPOSAL_REPORT_REASONS.map((r) => (
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
                      {otherName} will also be blocked from this proposal.
                    </p>
                    <div className="flex gap-2">
                      <button className="btn text-sm">Send report</button>
                      <button
                        type="button"
                        className="btn-outline text-sm"
                        onClick={() => setView('menu')}
                      >
                        Back
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {notice && <p className="mt-2 alert-positive text-xs">{notice}</p>}

      <div className="flex-1 space-y-2 overflow-y-auto py-3">
        {thread.notes.map((n) => (
          <div key={n.id} className={`flex ${n.mine ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                n.mine ? 'bg-brand text-brand-fg' : 'bg-gray-100 text-gray-800'
              }`}
            >
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className={`mt-1 text-[10px] ${n.mine ? 'text-brand-fg/70' : 'text-gray-500'}`}>
                {new Date(n.createdAt).toLocaleString()}
              </p>
            </div>
          </div>
        ))}
        {thread.notes.length === 0 && (
          <p className="text-sm text-gray-400">
            No notes yet. Open the conversation with the other side.
          </p>
        )}
        <div ref={bottom} />
      </div>

      {/* A withdrawn or declined proposal is closed — no more notes (EZ1-I130). */}
      {closed ? (
        <p className="border-t pt-2 text-sm text-gray-500">
          This proposal is closed ({thread.status === 'withdrawn' ? 'withdrawn' : 'declined'}). No
          further messages can be sent.
        </p>
      ) : notYetAccepted ? (
        <p className="border-t pt-2 text-sm text-gray-500">
          This conversation opens once the interest is accepted.
        </p>
      ) : blocked ? (
        <p className="border-t pt-2 text-sm text-gray-500">
          You blocked {otherName}. No further messages can be sent here. Unblock from the menu to
          reopen it.
        </p>
      ) : (
        <form onSubmit={post} className="flex gap-2 border-t pt-2">
          <input
            className="input flex-1"
            placeholder="A note to the other side"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <button className="btn" disabled={busy || !body.trim()}>
            Send
          </button>
        </form>
      )}
    </>
  );
}
