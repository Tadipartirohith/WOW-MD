import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfigService } from '../../config/app-config.service';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/chat.dto';
import { User } from '../auth/entities/user.entity';
import { Permission, roleHasPermission } from '../../common/authz/permissions';

/**
 * Real-time chat. Authenticated on the handshake via JWT. Runs behind the Redis
 * Socket.io adapter (see RedisIoAdapter) so events fan out across all replicas.
 * Each user joins a room named by their userId; a message is emitted to the
 * recipient's room regardless of which replica they are connected to.
 */
@WebSocketGateway({ namespace: 'chat', cors: true })
export class ChatGateway implements OnGatewayConnection {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chat: ChatService,
    private readonly jwt: JwtService,
    private readonly cfg: AppConfigService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers?.authorization as string)?.replace('Bearer ', '');
      const payload = await this.jwt.verifyAsync(token, { secret: this.cfg.auth.jwtSecret });

      // Same rule as the HTTP strategy: role and status come from the database,
      // not the token, so a suspension takes effect on the next connection.
      const user = await this.users.findOne({
        where: { id: payload.sub },
        select: ['id', 'role', 'isActive'],
      });
      if (!user || !user.isActive) throw new Error('inactive');
      if (!roleHasPermission(user.role, Permission.CHAT_INQUIRE)) throw new Error('forbidden');

      client.data.userId = user.id;
      client.data.role = user.role;
      client.join(`user:${user.id}`);
    } catch {
      this.logger.warn('Rejected socket: invalid token or ineligible account');
      client.disconnect(true);
    }
  }

  /**
   * The global ValidationPipe is HTTP-only, so the WS payload is validated here
   * explicitly — otherwise this route would accept an unvalidated body.
   */
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @SubscribeMessage('message:send')
  async onMessage(@ConnectedSocket() client: Socket, @MessageBody() dto: SendMessageDto) {
    const senderId = client.data.userId as string;
    if (!senderId) return { error: 'unauthenticated' };

    try {
      const message = await this.chat.persistMessage(senderId, dto.toUserId, dto.body, dto.mediaUrl);

      // Deliver to recipient and echo to sender (any replica) via Redis adapter.
      this.server.to(`user:${dto.toUserId}`).emit('message:new', message);
      this.server.to(`user:${senderId}`).emit('message:new', message);
      return message;
    } catch (err) {
      // Surface the authorization decision to the client instead of dropping
      // the frame silently.
      const reason = err instanceof Error ? err.message : 'Message rejected';
      return { error: reason };
    }
  }
}
