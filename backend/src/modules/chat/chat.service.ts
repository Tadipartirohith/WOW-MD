import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThan, Repository } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { Interest } from '../matchmaking/entities/interest.entity';
import { ChatBlock, ChatReport } from './entities/chat-block.entity';
import { ChatPreference } from './entities/chat-preference.entity';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import {
  InterestStatus,
  MatchFixedState,
  ThreadKind,
  UserRole,
  isIndividual,
  isProvider,
} from '../../common/enums';
import { ageBand } from '../users/dto/public-profile.dto';
import { CompatibilityEngine } from '../matchmaking/compatibility.engine';
import { ProfileDetails } from '../profile-details/entities/profile-details.entity';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';
import { AppConfigService } from '../../config/app-config.service';
import { PresenceService } from './presence.service';
import { OutboxService } from '../../platform/events/outbox.service';
import { redactContacts } from '../../common/util/redaction';

/**
 * Why these two are talking at all.
 *
 * A conversation list of names and last messages loses the one fact that makes
 * a matrimony chat different from any other: this thread exists because two
 * families agreed to it. Carrying the score and the standing means the header
 * can say "82% match \u00b7 interest accepted" rather than leaving the reader
 * to remember which of four conversations this is.
 */
export interface ConversationContext {
  interestId: string;
  score: number | null;
  standing: 'accepted' | 'fixed';
}

/** One row of the chat dashboard. */
export interface ConversationSummary {
  conversationId: string;
  withUserId: string;
  /** This reader's own setting. The other side's list is unaffected. */
  muted: boolean;
  displayName: string;
  photoUrl: string | null;
  lastMessage: string | null;
  lastMessageAt: Date | null;
  lastMessageMine: boolean;
  /** True when the last message in the thread has been read by the other side. */
  lastMessageRead: boolean;
  unread: number;
  online: boolean;
  /**
   * Who this is, beyond a name.
   *
   * Two people called Pardhu in the same list is not a hypothetical — it was
   * the reported problem. The code disambiguates them permanently; the age and
   * town are what a reader actually uses to tell them apart at a glance.
   */
  profileId: string | null;
  profileCode: string | null;
  ageRange: string | null;
  city: string | null;
  lastActiveAt: Date | null;
  context: ConversationContext | null;
}

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Conversation) private readonly conversations: Repository<Conversation>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(Interest) private readonly interests: Repository<Interest>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(ChatBlock) private readonly blocks: Repository<ChatBlock>,
    @InjectRepository(ChatReport) private readonly reports: Repository<ChatReport>,
    @InjectRepository(ChatPreference) private readonly prefs: Repository<ChatPreference>,
    private readonly audit: AuditService,
    private readonly cfg: AppConfigService,
    private readonly presence: PresenceService,
    private readonly engine: CompatibilityEngine,
    @InjectRepository(ProfileDetails)
    private readonly details: Repository<ProfileDetails>,
    private readonly outbox: OutboxService,
  ) {}

  private async loadPair(a: string, b: string): Promise<[User, User]> {
    const [userA, userB] = await Promise.all([
      this.users.findOne({
        where: { id: a },
        select: ['id', 'role', 'isActive', 'managedByAgentId'],
      }),
      this.users.findOne({
        where: { id: b },
        select: ['id', 'role', 'isActive', 'managedByAgentId'],
      }),
    ]);
    if (!userA || !userB) throw new NotFoundException('User not found');
    if (!userB.isActive) throw new ForbiddenException('That account is not available');
    return [userA, userB];
  }

  /**
   * Match check between two ACCOUNTS.
   *
   * Interests live between profiles, so this resolves each account's profile
   * first. A person who has not claimed a profile cannot chat at all — there is
   * no account to chat with — which is why the invitation flow exists.
   */
  private async hasAcceptedMatch(userA: string, userB: string): Promise<boolean> {
    const [profileA, profileB] = await Promise.all([
      this.profiles.findOne({ where: { userId: userA } }),
      this.profiles.findOne({ where: { userId: userB } }),
    ]);
    if (!profileA || !profileB) return false;

    const match = await this.interests.findOne({
      where: [
        {
          fromProfileId: profileA.id,
          toProfileId: profileB.id,
          status: InterestStatus.ACCEPTED,
        },
        {
          fromProfileId: profileB.id,
          toProfileId: profileA.id,
          status: InterestStatus.ACCEPTED,
        },
      ],
    });
    return Boolean(match);
  }

  /**
   * Who may talk to whom. Three legitimate reasons for a thread to exist:
   *
   *  MATCH          two individuals whose profiles have an accepted interest
   *  INQUIRY        a buyer-side account contacting a vendor/planner/agent, or
   *                 that provider or agent replying
   *  REPRESENTATION a managed client and the agent who represents them
   *
   * Anything else is refused, which is what keeps the platform from becoming an
   * open message-anyone channel.
   */
  async assertCanChat(senderId: string, recipientId: string): Promise<ThreadKind> {
    if (senderId === recipientId) throw new ForbiddenException('You cannot message yourself');
    const [sender, recipient] = await this.loadPair(senderId, recipientId);

    if (sender.role === UserRole.ADMIN || recipient.role === UserRole.ADMIN) {
      return ThreadKind.INQUIRY;
    }

    // The agent who represents this account, in either direction.
    if (sender.managedByAgentId === recipient.id || recipient.managedByAgentId === sender.id) {
      return ThreadKind.REPRESENTATION;
    }

    // Individual to individual: only after a mutual match.
    if (isIndividual(sender.role) && isIndividual(recipient.role)) {
      if (await this.hasAcceptedMatch(senderId, recipientId)) return ThreadKind.MATCH;
      throw new ForbiddenException('You can only chat with accepted matches');
    }

    // A user or agent may approach any provider or agent, and be replied to.
    // This is the "approach any user/agent" path for self-registered users.
    const inquiryPair =
      isProvider(recipient.role) ||
      recipient.role === UserRole.AGENT ||
      isProvider(sender.role) ||
      sender.role === UserRole.AGENT;
    if (inquiryPair) return ThreadKind.INQUIRY;

    throw new ForbiddenException('You are not permitted to message this account');
  }

  private key(a: string, b: string): [string, string] {
    return a < b ? [a, b] : [b, a];
  }

  async getOrCreateConversation(
    userA: string,
    userB: string,
    bookingId: string | null = null,
  ): Promise<Conversation> {
    const [participantA, participantB] = this.key(userA, userB);
    let convo = await this.conversations.findOne({
      where: { participantA, participantB, bookingId: bookingId ?? IsNull() },
    });
    if (!convo) {
      convo = await this.conversations.save(
        this.conversations.create({ participantA, participantB, bookingId }),
      );
    }
    return convo;
  }

  /**
   * Writes into a thread whose authorization somebody else has already done.
   *
   * The booking module owns the question of who may talk about a booking and
   * when, because that answer is made of payment state and job state, which are
   * its own. What is shared is everything below that: redaction before the
   * write, the block, the message store, read receipts.
   *
   * Blocks still apply. A buyer who blocked a vendor is told the conversation
   * is closed rather than having the message quietly swallowed, and a booking
   * that has gone that wrong has the dispute channel, which is a better place
   * for it than a chat thread.
   */
  async postToBookingThread(
    bookingId: string,
    senderId: string,
    recipientId: string,
    body: string,
    mediaUrl?: string,
  ): Promise<Message> {
    await this.assertNotBlocked(senderId, recipientId);
    const convo = await this.getOrCreateConversation(senderId, recipientId, bookingId);

    const { text, redactions } = this.cfg.features.chatRedactContacts
      ? redactContacts(body)
      : { text: body, redactions: 0 };

    return this.messages.save(
      this.messages.create({
        conversationId: convo.id,
        senderId,
        body: text,
        redactedCount: redactions,
        mediaUrl: mediaUrl ?? null,
      }),
    );
  }

  /**
   * One booking's thread, oldest last like every other history here.
   *
   * Readable after the job is finished even though it can no longer be written
   * to: what was agreed in chat is exactly what somebody needs six weeks later
   * when they are arguing about it.
   */
  async bookingHistory(
    bookingId: string,
    userA: string,
    userB: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<Message>> {
    const convo = await this.getOrCreateConversation(userA, userB, bookingId);
    const [data, total] = await this.messages.findAndCount({
      where: { conversationId: convo.id },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return paginate(data, total, page, limit);
  }

  /** Marks the other side's messages in one booking thread as read. */
  async markBookingRead(bookingId: string, userId: string, otherUserId: string) {
    const convo = await this.getOrCreateConversation(userId, otherUserId, bookingId);
    const result = await this.messages.update(
      { conversationId: convo.id, senderId: otherUserId, readAt: IsNull() },
      { readAt: new Date() },
    );
    return { marked: result.affected ?? 0 };
  }

  /**
   * Stores a message, with contact details stripped out first.
   *
   * Redaction happens before the write, not on the way out: a number that
   * reaches the database has already leaked to anyone with a database, and
   * masking it at render time would be theatre. `redactedCount` is kept so
   * repeated attempts to pass a number across are visible to an investigator
   * without the platform having to keep the number itself.
   */
  async persistMessage(
    senderId: string,
    toUserId: string,
    body: string,
    mediaUrl?: string,
  ): Promise<Message> {
    const kind = await this.assertCanChat(senderId, toUserId);
    await this.assertNotBlocked(senderId, toUserId);
    const convo = await this.getOrCreateConversation(senderId, toUserId);

    const { text, redactions } = this.cfg.features.chatRedactContacts
      ? redactContacts(body)
      : { text: body, redactions: 0 };

    const saved = await this.messages.save(
      this.messages.create({
        conversationId: convo.id,
        senderId,
        body: text,
        redactedCount: redactions,
        mediaUrl: mediaUrl ?? null,
      }),
    );

    /*
     * The agency finds out their introduction has started moving.
     *
     * Only on the first message, and only between two matched individuals: an
     * agency running forty introductions does not want the day narrated, and
     * the count is what makes "started" mean started. It is cheap because it
     * is skipped entirely for every other kind of thread — a vendor enquiry
     * has no agent to tell.
     *
     * The conversation row cannot stand in for this. Opening a chat creates
     * one, so an agent would be told about a conversation nobody had spoken in.
     */
    if (kind === ThreadKind.MATCH) {
      const isFirst = (await this.messages.count({ where: { conversationId: convo.id } })) === 1;
      if (isFirst) await this.announceToStewards(senderId, toUserId, 'message');
    }

    return saved;
  }

  /**
   * Tells whoever manages either side that their clients have started talking.
   *
   * Nothing that was said travels with it — the agent is told that something
   * began, not what is in it, which is the line drawn everywhere else here.
   * Raised through the outbox so chat stays unaware of notifications.
   */
  async announceToStewards(
    userA: string,
    userB: string,
    kind: 'message' | 'call',
  ): Promise<void> {
    const profiles = await this.profiles.find({ where: [{ userId: userA }, { userId: userB }] });
    if (profiles.length === 0) return;

    const stewards = [...new Set(profiles.map((p) => p.managedByUserId).filter(Boolean))];
    if (stewards.length === 0) return;

    const coupleNames = profiles.map((p) => p.displayName).filter(Boolean).join(' and ');

    for (const stewardUserId of stewards) {
      await this.outbox.record({
        eventType: 'match.conversation_started',
        aggregateType: 'conversation',
        payload: {
          stewardUserId,
          kind,
          coupleNames,
          // Whichever of the two this steward does not manage is the one their
          // client is talking to, and the one worth opening.
          counterpartProfileId:
            profiles.find((p) => p.managedByUserId !== stewardUserId)?.id ?? profiles[0].id,
        },
      });
    }
  }

  async history(
    userId: string,
    withUserId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<Message>> {
    await this.assertCanChat(userId, withUserId);
    const convo = await this.getOrCreateConversation(userId, withUserId);
    const pref = await this.prefs.findOne({ where: { userId, conversationId: convo.id } });

    // Everything before this reader cleared the thread is theirs to not see.
    // The other side's copy is untouched, and the rows are still there for a
    // report or a dispute — clearing is about one person's screen.
    const [data, total] = await this.messages.findAndCount({
      where: {
        conversationId: convo.id,
        ...(pref?.clearedAt ? { createdAt: MoreThan(pref.clearedAt) } : {}),
      },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return paginate(data, total, page, limit);
  }

  /**
   * The chat dashboard: one row per person, most recently active first.
   *
   * The raw conversation rows were unusable on their own — two uuids and a
   * creation date, in the order the conversations happened to be created. What
   * somebody opening this screen actually needs is who it is with, what was
   * said last, whether anything is waiting on them, and whether the other side
   * is there right now.
   */
  /**
   * The accepted interest behind a conversation, scored.
   *
   * Looked up by the two *profiles* rather than the two accounts, because that
   * is what an interest is between — an agency-built profile has no account at
   * all until its subject claims it.
   */
  private async contextFor(
    mine: Profile | undefined,
    theirs: Profile | undefined,
  ): Promise<ConversationContext | null> {
    if (!mine || !theirs) return null;
    const interest = await this.interests.findOne({
      where: [
        { fromProfileId: mine.id, toProfileId: theirs.id },
        { fromProfileId: theirs.id, toProfileId: mine.id },
      ],
      order: { createdAt: 'DESC' },
    });
    if (!interest || interest.status !== InterestStatus.ACCEPTED) return null;

    // Both biodata rows, so the number on the chat header is the same number
    // the match card showed.
    const details = await this.details.find({ where: { profileId: In([mine.id, theirs.id]) } });
    const byProfile = new Map(details.map((d) => [d.profileId, d]));

    return {
      interestId: interest.id,
      score: this.engine.score(
        { profile: mine, details: byProfile.get(mine.id) ?? null },
        { profile: theirs, details: byProfile.get(theirs.id) ?? null },
      ).score,
      standing:
        interest.matchFixedState === MatchFixedState.CONFIRMED ? 'fixed' : 'accepted',
    };
  }

  async listConversations(userId: string): Promise<ConversationSummary[]> {
    // Direct threads only. A booking's thread lives on the booking, where its
    // rules are — surfacing it here would offer a vendor a conversation the
    // Chat screen has no way to lock when the job finishes.
    const rows = await this.conversations.find({
      where: [
        { participantA: userId, bookingId: IsNull() },
        { participantB: userId, bookingId: IsNull() },
      ],
    });

    const otherIds = rows.map((c) => (c.participantA === userId ? c.participantB : c.participantA));

    // An accepted match with nothing said yet has no conversation row — one is
    // only created on the first message. Leaving those out is what made a fresh
    // match look unreachable: the two families had agreed to talk and the list
    // was empty. They appear here as threads waiting to be started.
    const pending = await this.matchedButSilent(userId, otherIds);
    if (rows.length === 0 && pending.length === 0) return [];
    otherIds.push(...pending);

    const [profiles, online] = await Promise.all([
      this.profiles.find({ where: { userId: In(otherIds) } }),
      this.presence.onlineAmong(otherIds),
    ]);
    const profileByUser = new Map(profiles.map((p) => [p.userId as string, p]));

    const myProfile = await this.profiles.findOne({ where: { userId } });

    const silent: ConversationSummary[] = await Promise.all(
      pending.map(async (otherUserId) => {
        const profile = profileByUser.get(otherUserId);
        return {
          conversationId: '',
          withUserId: otherUserId,
          muted: false,
          displayName: profile?.displayName ?? 'Match',
          photoUrl: profile?.photos?.[0] ?? null,
          lastMessage: null,
          lastMessageAt: null,
          lastMessageMine: false,
          lastMessageRead: false,
          unread: 0,
          online: online.has(otherUserId),
          profileId: profile?.id ?? null,
          profileCode: profile?.profileCode ?? null,
          ageRange: ageBand(profile?.dateOfBirth ?? null),
          city: profile?.city ?? null,
          lastActiveAt: profile?.lastActiveAt ?? null,
          context: await this.contextFor(myProfile ?? undefined, profile),
        };
      }),
    );

    // This reader's settings for these threads, in one read rather than one
    // per row.
    const prefs = rows.length
      ? await this.prefs.find({ where: { userId, conversationId: In(rows.map((c) => c.id)) } })
      : [];
    const prefByConvo = new Map(prefs.map((p) => [p.conversationId, p]));

    const summaries = await Promise.all(
      rows.map(async (convo) => {
        const otherUserId = convo.participantA === userId ? convo.participantB : convo.participantA;
        const pref = prefByConvo.get(convo.id);
        const since = pref?.clearedAt ? { createdAt: MoreThan(pref.clearedAt) } : {};
        const [last, unread] = await Promise.all([
          this.messages.findOne({
            where: { conversationId: convo.id, ...since },
            order: { createdAt: 'DESC' },
          }),
          this.messages.count({
            where: {
              conversationId: convo.id,
              senderId: otherUserId,
              readAt: IsNull(),
              ...since,
            },
          }),
        ]);
        const profile = profileByUser.get(otherUserId);

        return {
          conversationId: convo.id,
          withUserId: otherUserId,
          muted: Boolean(pref?.muted),
          displayName: profile?.displayName ?? 'Match',
          photoUrl: profile?.photos?.[0] ?? null,
          lastMessage: last?.body ?? null,
          lastMessageAt: last?.createdAt ?? null,
          lastMessageMine: last ? last.senderId === userId : false,
          // Only meaningful on a message this reader sent: it is the second
          // tick. On a received message it is trivially true and says nothing.
          lastMessageRead: Boolean(last && last.senderId === userId && last.readAt),
          unread,
          online: online.has(otherUserId),
          profileId: profile?.id ?? null,
          profileCode: profile?.profileCode ?? null,
          ageRange: ageBand(profile?.dateOfBirth ?? null),
          city: profile?.city ?? null,
          lastActiveAt: profile?.lastActiveAt ?? null,
          context: await this.contextFor(myProfile ?? undefined, profile),
        };
      }),
    );

    // A thread this reader deleted stays out of their list until something new
    // arrives in it. Hiding it for good would mean a message sent to somebody
    // who is never shown it, which is worse than a conversation reappearing.
    const visible = summaries.filter((row) => {
      const pref = prefByConvo.get(row.conversationId);
      if (!pref?.deletedAt) return true;
      return Boolean(row.lastMessageAt && row.lastMessageAt > pref.deletedAt);
    });

    // Most recent first, and a conversation nobody has spoken in yet sinks to
    // the bottom rather than sitting at the top on its creation date.
    return [...visible, ...silent].sort((a, b) => {
      const at = a.lastMessageAt?.getTime() ?? 0;
      const bt = b.lastMessageAt?.getTime() ?? 0;
      return bt - at;
    });
  }

  /**
   * Accounts this user has an accepted match with but no thread for yet.
   *
   * Keyed on profiles, because that is where an interest lives, then resolved
   * back to accounts — a matched profile whose owner has not claimed it has no
   * account to message, and is correctly absent.
   */
  private async matchedButSilent(userId: string, alreadyListed: string[]): Promise<string[]> {
    const profile = await this.profiles.findOne({ where: { userId } });
    if (!profile) return [];

    const accepted = await this.interests.find({
      where: [
        { fromProfileId: profile.id, status: InterestStatus.ACCEPTED },
        { toProfileId: profile.id, status: InterestStatus.ACCEPTED },
      ],
    });
    if (accepted.length === 0) return [];

    const otherProfileIds = accepted.map((i) =>
      i.fromProfileId === profile.id ? i.toProfileId : i.fromProfileId,
    );
    const others = await this.profiles.find({ where: { id: In(otherProfileIds) } });

    const seen = new Set(alreadyListed);
    return others
      .map((p) => p.userId)
      .filter((id): id is string => Boolean(id) && !seen.has(id as string));
  }

  // ------------------------------------------------------- blocking

  /**
   * Refuses a message either side has blocked.
   *
   * The wording is the same in both directions and says nothing about a block.
   * Telling a sender they have been blocked turns a quiet exit into an
   * argument, and telling them nothing at all leaves them typing into a void —
   * so it reads as the conversation being closed, which is true.
   */
  private async assertNotBlocked(senderId: string, recipientId: string): Promise<void> {
    const block = await this.blocks.findOne({
      where: [
        { blockerUserId: recipientId, blockedUserId: senderId },
        { blockerUserId: senderId, blockedUserId: recipientId },
      ],
    });
    if (block) {
      throw new ForbiddenException('This conversation is closed.');
    }
  }

  /**
   * This reader's settings for one thread, created on first use.
   *
   * Per reader rather than per conversation: muting and clearing are one
   * side's decisions about their own screen, and putting them on the shared row
   * would make them instructions to the other person.
   */
  private async preference(userId: string, conversationId: string): Promise<ChatPreference> {
    const existing = await this.prefs.findOne({ where: { userId, conversationId } });
    if (existing) return existing;
    return this.prefs.save(this.prefs.create({ userId, conversationId }));
  }

  /** Stop this thread interrupting you. It still receives messages. */
  async setMuted(userId: string, withUserId: string, muted: boolean) {
    const convo = await this.getOrCreateConversation(userId, withUserId);
    const pref = await this.preference(userId, convo.id);
    pref.muted = muted;
    await this.prefs.save(pref);
    return { muted };
  }

  /**
   * Empties the thread for the person who asked, and for nobody else.
   *
   * A watermark rather than a delete. Messages are what a dispute is argued
   * from and what a report is investigated with, so clearing hides the history
   * from this reader and destroys nothing — which is also what the request
   * actually means: they want their screen empty, not the record gone.
   */
  async clear(userId: string, withUserId: string) {
    const convo = await this.getOrCreateConversation(userId, withUserId);
    const pref = await this.preference(userId, convo.id);
    pref.clearedAt = new Date();
    await this.prefs.save(pref);
    return { cleared: true, clearedAt: pref.clearedAt };
  }

  /**
   * Removes the thread from this reader's list.
   *
   * A new message brings it back, and that is deliberate: the alternative is a
   * message sent to somebody who is never shown it, which is worse than a
   * conversation reappearing.
   */
  async deleteConversation(userId: string, withUserId: string) {
    const convo = await this.getOrCreateConversation(userId, withUserId);
    const pref = await this.preference(userId, convo.id);
    pref.deletedAt = new Date();
    // Deleting implies clearing: a thread that comes back should come back
    // empty rather than showing everything the reader thought they had removed.
    pref.clearedAt = new Date();
    await this.prefs.save(pref);
    return { deleted: true };
  }

  /**
   * Finds a phrase inside one conversation.
   *
   * Scoped to the thread rather than searching everything, because that is the
   * question being asked — "where did they say the venue" — and a search across
   * every conversation somebody has is a different feature with different
   * privacy consequences.
   *
   * Cleared messages stay hidden. Somebody who emptied a thread and then
   * searched it would otherwise get back exactly what they had removed.
   */
  async searchConversation(
    userId: string,
    withUserId: string,
    term: string,
  ): Promise<Message[]> {
    await this.assertCanChat(userId, withUserId);
    const convo = await this.getOrCreateConversation(userId, withUserId);
    const pref = await this.prefs.findOne({ where: { userId, conversationId: convo.id } });

    const qb = this.messages
      .createQueryBuilder('m')
      .where('m."conversationId" = :id', { id: convo.id })
      // Case-insensitive contains. The bodies are already redacted, so a search
      // cannot recover a number the platform stripped on the way in.
      .andWhere('LOWER(m.body) LIKE :term', { term: `%${term.toLowerCase()}%` })
      .orderBy('m."createdAt"', 'DESC')
      .take(50);

    if (pref?.clearedAt) qb.andWhere('m."createdAt" > :since', { since: pref.clearedAt });
    return qb.getMany();
  }

  /** Idempotent: tapping block twice is one block, not two. */
  async block(userId: string, otherUserId: string, note?: string) {
    if (userId === otherUserId) {
      throw new BadRequestException('You cannot block yourself');
    }
    const existing = await this.blocks.findOne({
      where: { blockerUserId: userId, blockedUserId: otherUserId },
    });
    if (existing) return { blocked: true, since: existing.createdAt };

    const saved = await this.blocks.save(
      this.blocks.create({
        blockerUserId: userId,
        blockedUserId: otherUserId,
        note: note ?? null,
      }),
    );
    return { blocked: true, since: saved.createdAt };
  }

  async unblock(userId: string, otherUserId: string) {
    await this.blocks.delete({ blockerUserId: userId, blockedUserId: otherUserId });
    return { blocked: false };
  }

  /** Who this account has blocked, and whether one particular person is on it. */
  async blockState(userId: string, otherUserId: string) {
    const mine = await this.blocks.findOne({
      where: { blockerUserId: userId, blockedUserId: otherUserId },
    });
    // Deliberately does not report a block in the other direction: knowing you
    // have been blocked is the thing this is designed not to tell you.
    return { blocked: Boolean(mine), since: mine?.createdAt ?? null };
  }

  /**
   * Reports somebody, with the last few messages copied in as they stand.
   *
   * Copied rather than referenced: evidence that changes afterwards is not
   * evidence, and a reported message the platform later redacts would leave an
   * investigator with nothing to look at.
   */
  async report(userId: string, otherUserId: string, reason: string, detail?: string) {
    if (userId === otherUserId) {
      throw new BadRequestException('You cannot report yourself');
    }

    const convo = await this.conversations.findOne({
      where: [
        { participantA: userId, participantB: otherUserId, bookingId: IsNull() },
        { participantA: otherUserId, participantB: userId, bookingId: IsNull() },
      ],
    });

    let evidence: { at: string; fromMe: boolean; body: string }[] = [];
    if (convo) {
      const recent = await this.messages.find({
        where: { conversationId: convo.id },
        order: { createdAt: 'DESC' },
        take: 20,
      });
      evidence = recent.reverse().map((m) => ({
        at: m.createdAt.toISOString(),
        fromMe: m.senderId === userId,
        body: m.body,
      }));
    }

    const saved = await this.reports.save(
      this.reports.create({
        reporterUserId: userId,
        reportedUserId: otherUserId,
        reason,
        detail: detail ?? null,
        evidence,
      }),
    );

    await this.audit.record({
      action: AuditAction.CHAT_USER_REPORTED,
      actor: { userId, role: UserRole.BRIDE },
      resourceType: 'user',
      resourceId: otherUserId,
      metadata: { reportId: saved.id, reason, messages: evidence.length },
    });

    // Reporting somebody almost always means you also want them to stop, so
    // the block comes with it rather than being a second thing to find.
    await this.block(userId, otherUserId, `Reported: ${reason}`);
    return { reportId: saved.id, blocked: true };
  }

  /**
   * Marks everything the other person sent as read.
   *
   * Only their messages: marking your own read would be meaningless, and it is
   * their unread badge that has to clear.
   */
  async markRead(userId: string, withUserId: string): Promise<{ marked: number }> {
    const convo = await this.conversations.findOne({
      where: [
        { participantA: userId, participantB: withUserId, bookingId: IsNull() },
        { participantA: withUserId, participantB: userId, bookingId: IsNull() },
      ],
    });
    if (!convo) return { marked: 0 };

    const result = await this.messages.update(
      { conversationId: convo.id, senderId: withUserId, readAt: IsNull() },
      { readAt: new Date() },
    );
    return { marked: result.affected ?? 0 };
  }

  /** Presence for one person, for the header of an open conversation. */
  async presenceOf(withUserId: string): Promise<{ online: boolean; lastSeen: Date | null }> {
    const [online, lastSeen] = await Promise.all([
      this.presence.isOnline(withUserId),
      this.presence.lastSeen(withUserId),
    ]);
    return { online, lastSeen };
  }
}
