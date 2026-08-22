import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
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
import { PresenceService } from './presence.service';
import { buildIceServers } from './ice-servers';

/**
 * Real-time chat. Authenticated on the handshake via JWT. Runs behind the Redis
 * Socket.io adapter (see RedisIoAdapter) so events fan out across all replicas.
 * Each user joins a room named by their userId; a message is emitted to the
 * recipient's room regardless of which replica they are connected to.
 */
@WebSocketGateway({ namespace: 'chat', cors: true })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chat: ChatService,
    private readonly jwt: JwtService,
    private readonly cfg: AppConfigService,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly presence: PresenceService,
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

      await this.presence.markOnline(user.id);
      this.server.emit('presence:changed', { userId: user.id, online: true });
    } catch {
      this.logger.warn('Rejected socket: invalid token or ineligible account');
      client.disconnect(true);
    }
  }

  /**
   * A clean close. An unclean one — a lid shutting, a tunnel — is caught by the
   * TTL on the presence key instead, which is why presence is not a flag.
   */
  async handleDisconnect(client: Socket) {
    const userId = client.data.userId as string | undefined;
    if (!userId) return;

    // Several tabs are normal. Only the last one closing means they have gone.
    const sockets = await this.server.in(`user:${userId}`).fetchSockets();
    if (sockets.length > 0) return;

    await this.presence.markOffline(userId);
    this.server.emit('presence:changed', { userId, online: false });
  }

  /** Keeps the presence key alive while a tab is open but quiet. */
  @SubscribeMessage('presence:heartbeat')
  async onHeartbeat(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId as string | undefined;
    if (userId) await this.presence.markOnline(userId);
    return { ok: true };
  }

  // ------------------------------------------------------------- calling
  //
  // WebRTC signalling, and nothing more. The media never touches this server:
  // the two browsers negotiate through these three messages and then talk
  // directly. That is what makes voice and video affordable — a relay carrying
  // every call's audio is a bandwidth bill that scales with usage.
  //
  // ICE servers come from config. Public STUN is enough for most home and
  // mobile networks; a symmetric NAT on one side needs a TURN relay, and
  // without one those calls will fail to connect rather than fail silently —
  // `call:failed` says so rather than leaving a ringing screen forever.

  /**
   * Offer a call. Reuses the chat authorization rule exactly: if you may not
   * message somebody, you may not ring them either.
   */
  @SubscribeMessage('call:offer')
  async onCallOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { toUserId: string; sdp: string; media: 'audio' | 'video' },
  ) {
    const callerId = client.data.userId as string;
    if (!callerId) return { error: 'unauthenticated' };
    if (typeof payload?.toUserId !== 'string' || typeof payload?.sdp !== 'string') {
      return { error: 'A call offer needs a recipient and an SDP' };
    }

    try {
      await this.chat.assertCanChat(callerId, payload.toUserId);
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Call rejected' };
    }

    // Nobody on the other end is a normal outcome, not an error: it is a
    // missed call, and the caller needs to be told rather than left ringing.
    const sockets = await this.server.in(`user:${payload.toUserId}`).fetchSockets();
    if (sockets.length === 0) {
      return { error: 'unavailable', reason: 'They are not online right now' };
    }

    this.server.to(`user:${payload.toUserId}`).emit('call:incoming', {
      fromUserId: callerId,
      sdp: payload.sdp,
      media: payload.media === 'video' ? 'video' : 'audio',
    });
    return { ringing: true, iceServers: buildIceServers(process.env) };
  }

  /** The callee picks up. */
  @SubscribeMessage('call:answer')
  async onCallAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { toUserId: string; sdp: string },
  ) {
    const userId = client.data.userId as string;
    if (!userId) return { error: 'unauthenticated' };
    if (typeof payload?.toUserId !== 'string' || typeof payload?.sdp !== 'string') {
      return { error: 'An answer needs a recipient and an SDP' };
    }

    try {
      await this.chat.assertCanChat(userId, payload.toUserId);
    } catch {
      return { error: 'Call rejected' };
    }

    this.server.to(`user:${payload.toUserId}`).emit('call:answered', {
      fromUserId: userId,
      sdp: payload.sdp,
    });
    return { ok: true, iceServers: buildIceServers(process.env) };
  }

  /**
   * Candidate exchange, which continues for the life of the negotiation.
   *
   * Deliberately not authorization-checked on every candidate: the offer and
   * the answer were, and re-running the whole chat rule for each of the dozens
   * of candidates a connection produces would put a database round trip on a
   * path that has to complete in a second or two.
   */
  @SubscribeMessage('call:candidate')
  onCallCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { toUserId: string; candidate: unknown },
  ) {
    const userId = client.data.userId as string;
    if (!userId || typeof payload?.toUserId !== 'string') return { error: 'unauthenticated' };

    this.server.to(`user:${payload.toUserId}`).emit('call:candidate', {
      fromUserId: userId,
      candidate: payload.candidate,
    });
    return { ok: true };
  }

  /** Hang up, decline, or give up on a connection that will not form. */
  @SubscribeMessage('call:end')
  onCallEnd(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { toUserId: string; reason?: string },
  ) {
    const userId = client.data.userId as string;
    if (!userId || typeof payload?.toUserId !== 'string') return { error: 'unauthenticated' };

    this.server.to(`user:${payload.toUserId}`).emit('call:ended', {
      fromUserId: userId,
      reason: payload.reason ?? 'ended',
    });
    return { ok: true };
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
