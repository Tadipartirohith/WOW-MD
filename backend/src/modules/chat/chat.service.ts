import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { Interest } from '../matchmaking/entities/interest.entity';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import {
  InterestStatus,
  ThreadKind,
  UserRole,
  isIndividual,
  isProvider,
} from '../../common/enums';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';
import { AppConfigService } from '../../config/app-config.service';
import { PresenceService } from './presence.service';
import { redactContacts } from '../../common/util/redaction';

/** One row of the chat dashboard. */
export interface ConversationSummary {
  conversationId: string;
  withUserId: string;
  displayName: string;
  photoUrl: string | null;
  lastMessage: string | null;
  lastMessageAt: Date | null;
  lastMessageMine: boolean;
  unread: number;
  online: boolean;
}

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Conversation) private readonly conversations: Repository<Conversation>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(Interest) private readonly interests: Repository<Interest>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly cfg: AppConfigService,
    private readonly presence: PresenceService,
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

  async getOrCreateConversation(userA: string, userB: string): Promise<Conversation> {
    const [participantA, participantB] = this.key(userA, userB);
    let convo = await this.conversations.findOne({ where: { participantA, participantB } });
    if (!convo) {
      convo = await this.conversations.save(
        this.conversations.create({ participantA, participantB }),
      );
    }
    return convo;
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
    await this.assertCanChat(senderId, toUserId);
    const convo = await this.getOrCreateConversation(senderId, toUserId);

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

  async history(
    userId: string,
    withUserId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<Message>> {
    await this.assertCanChat(userId, withUserId);
    const convo = await this.getOrCreateConversation(userId, withUserId);
    const [data, total] = await this.messages.findAndCount({
      where: { conversationId: convo.id },
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
  async listConversations(userId: string): Promise<ConversationSummary[]> {
    const rows = await this.conversations.find({
      where: [{ participantA: userId }, { participantB: userId }],
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

    const silent: ConversationSummary[] = pending.map((otherUserId) => ({
      conversationId: '',
      withUserId: otherUserId,
      displayName: profileByUser.get(otherUserId)?.displayName ?? 'Match',
      photoUrl: profileByUser.get(otherUserId)?.photos?.[0] ?? null,
      lastMessage: null,
      lastMessageAt: null,
      lastMessageMine: false,
      unread: 0,
      online: online.has(otherUserId),
    }));

    const summaries = await Promise.all(
      rows.map(async (convo) => {
        const otherUserId = convo.participantA === userId ? convo.participantB : convo.participantA;
        const [last, unread] = await Promise.all([
          this.messages.findOne({
            where: { conversationId: convo.id },
            order: { createdAt: 'DESC' },
          }),
          this.messages.count({
            where: { conversationId: convo.id, senderId: otherUserId, readAt: IsNull() },
          }),
        ]);
        const profile = profileByUser.get(otherUserId);

        return {
          conversationId: convo.id,
          withUserId: otherUserId,
          displayName: profile?.displayName ?? 'Match',
          photoUrl: profile?.photos?.[0] ?? null,
          lastMessage: last?.body ?? null,
          lastMessageAt: last?.createdAt ?? null,
          lastMessageMine: last ? last.senderId === userId : false,
          unread,
          online: online.has(otherUserId),
        };
      }),
    );

    // Most recent first, and a conversation nobody has spoken in yet sinks to
    // the bottom rather than sitting at the top on its creation date.
    return [...summaries, ...silent].sort((a, b) => {
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

  /**
   * Marks everything the other person sent as read.
   *
   * Only their messages: marking your own read would be meaningless, and it is
   * their unread badge that has to clear.
   */
  async markRead(userId: string, withUserId: string): Promise<{ marked: number }> {
    const convo = await this.conversations.findOne({
      where: [
        { participantA: userId, participantB: withUserId },
        { participantA: withUserId, participantB: userId },
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
