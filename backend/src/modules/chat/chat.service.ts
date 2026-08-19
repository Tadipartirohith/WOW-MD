import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { Interest } from '../matchmaking/entities/interest.entity';
import { User } from '../auth/entities/user.entity';
import {
  InterestStatus,
  ThreadKind,
  UserRole,
  isIndividual,
  isProvider,
} from '../../common/enums';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Conversation) private readonly conversations: Repository<Conversation>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(Interest) private readonly interests: Repository<Interest>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  private async loadPair(a: string, b: string): Promise<[User, User]> {
    const [userA, userB] = await Promise.all([
      this.users.findOne({ where: { id: a }, select: ['id', 'role', 'isActive', 'managedByAgentId'] }),
      this.users.findOne({ where: { id: b }, select: ['id', 'role', 'isActive', 'managedByAgentId'] }),
    ]);
    if (!userA || !userB) throw new NotFoundException('User not found');
    if (!userB.isActive) throw new ForbiddenException('That account is not available');
    return [userA, userB];
  }

  private async hasAcceptedMatch(a: string, b: string): Promise<boolean> {
    const match = await this.interests.findOne({
      where: [
        { fromUserId: a, toUserId: b, status: InterestStatus.ACCEPTED },
        { fromUserId: b, toUserId: a, status: InterestStatus.ACCEPTED },
      ],
    });
    return Boolean(match);
  }

  /**
   * Who may talk to whom. Three legitimate reasons for a thread to exist:
   *
   *  MATCH          two individuals with an accepted interest between them
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
    if (
      sender.managedByAgentId === recipient.id ||
      recipient.managedByAgentId === sender.id
    ) {
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
      (isProvider(recipient.role) || recipient.role === UserRole.AGENT) ||
      (isProvider(sender.role) || sender.role === UserRole.AGENT);
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

  async persistMessage(
    senderId: string,
    toUserId: string,
    body: string,
    mediaUrl?: string,
  ): Promise<Message> {
    await this.assertCanChat(senderId, toUserId);
    const convo = await this.getOrCreateConversation(senderId, toUserId);
    return this.messages.save(
      this.messages.create({
        conversationId: convo.id,
        senderId,
        body,
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

  /** Threads the caller participates in, newest activity first. */
  async listConversations(userId: string): Promise<Conversation[]> {
    return this.conversations.find({
      where: [{ participantA: userId }, { participantB: userId }],
      order: { createdAt: 'DESC' },
    });
  }
}
