import { Logger } from '@nestjs/common';
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
import { AppConfigService } from '../../config/app-config.service';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/chat.dto';

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
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers?.authorization as string)?.replace('Bearer ', '');
      const payload = await this.jwt.verifyAsync(token, { secret: this.cfg.auth.jwtSecret });
      client.data.userId = payload.sub;
      client.join(`user:${payload.sub}`);
    } catch {
      this.logger.warn('Rejected socket: invalid token');
      client.disconnect(true);
    }
  }

  @SubscribeMessage('message:send')
  async onMessage(@ConnectedSocket() client: Socket, @MessageBody() dto: SendMessageDto) {
    const senderId = client.data.userId as string;
    if (!senderId) return { error: 'unauthenticated' };

    const message = await this.chat.persistMessage(senderId, dto.toUserId, dto.body, dto.mediaUrl);

    // Deliver to recipient and echo to sender (any replica) via Redis adapter.
    this.server.to(`user:${dto.toUserId}`).emit('message:new', message);
    this.server.to(`user:${senderId}`).emit('message:new', message);
    return message;
  }
}
