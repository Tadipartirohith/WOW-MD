import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { Interest } from '../matchmaking/entities/interest.entity';
import { InterestStatus } from '../../common/enums';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Conversation) private readonly conversations: Repository<Conversation>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(Interest) private readonly interests: Repository<Interest>,
  ) {}

  /** Chat is only allowed between users with an ACCEPTED match (spec: post-match). */
  async assertMatched(userA: string, userB: string): Promise<void> {
    const match = await this.interests.findOne({
      where: [
        { fromUserId: userA, toUserId: userB, status: InterestStatus.ACCEPTED },
        { fromUserId: userB, toUserId: userA, status: InterestStatus.ACCEPTED },
      ],
    });
    if (!match) throw new ForbiddenException('You can only chat with accepted matches');
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
    await this.assertMatched(senderId, toUserId);
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
    await this.assertMatched(userId, withUserId);
    const convo = await this.getOrCreateConversation(userId, withUserId);
    const [data, total] = await this.messages.findAndCount({
      where: { conversationId: convo.id },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return paginate(data, total, page, limit);
  }
}
