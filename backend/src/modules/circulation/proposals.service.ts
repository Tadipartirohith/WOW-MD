import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProposalNote } from './entities/proposal-note.entity';
import { Interest } from '../matchmaking/entities/interest.entity';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { PostProposalNoteDto } from './dto/sharing.dto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums';
import { toPublicProfile, PublicProfileView } from '../users/dto/public-profile.dto';

export interface ProposalThread {
  interestId: string;
  status: string;
  sides: { profile: PublicProfileView; handledBy: string | null; isMine: boolean }[];
  notes: {
    id: string;
    body: string;
    authorProfileId: string;
    mine: boolean;
    createdAt: Date;
  }[];
}

/**
 * The conversation between the two people handling a possible match.
 *
 * In practice a pairing is negotiated agent-to-agent: my client's side talks to
 * your client's side long before the two families meet. This hangs off the
 * existing interest record rather than inventing a parallel "proposal" object —
 * an interest already *is* the pairing.
 *
 * Access is "you control one of the two profiles": its owner, or its steward.
 */
@Injectable()
export class ProposalsService {
  constructor(
    @InjectRepository(ProposalNote) private readonly notes: Repository<ProposalNote>,
    @InjectRepository(Interest) private readonly interests: Repository<Interest>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  private controls(actor: AuthUser, profile: Profile): boolean {
    if (actor.role === UserRole.ADMIN) return true;
    if (profile.userId !== null && profile.userId === actor.userId) return true;
    return profile.managedByUserId === actor.userId;
  }

  /** Loads the pairing and both profiles, refusing anyone not on either side. */
  private async loadSides(
    actor: AuthUser,
    interestId: string,
  ): Promise<{ interest: Interest; from: Profile; to: Profile; mine: Profile[] }> {
    const interest = await this.interests.findOne({ where: { id: interestId } });
    if (!interest) throw new NotFoundException('That match no longer exists');

    const profiles = await this.profiles.find({
      where: { id: In([interest.fromProfileId, interest.toProfileId]) },
    });
    const from = profiles.find((p) => p.id === interest.fromProfileId);
    const to = profiles.find((p) => p.id === interest.toProfileId);
    if (!from || !to) throw new NotFoundException('That match no longer exists');

    const mine = [from, to].filter((p) => this.controls(actor, p));
    if (mine.length === 0) {
      throw new ForbiddenException('You are not handling either side of this match');
    }
    return { interest, from, to, mine };
  }

  async thread(actor: AuthUser, interestId: string): Promise<ProposalThread> {
    const { interest, from, to, mine } = await this.loadSides(actor, interestId);
    const notes = await this.notes.find({
      where: { interestId },
      order: { createdAt: 'ASC' },
    });

    // Who is handling each side, so the other agent knows who they are talking
    // to rather than seeing a bare uuid.
    const stewardIds = [from.managedByUserId, to.managedByUserId].filter(Boolean) as string[];
    const stewards = stewardIds.length
      ? await this.profiles.find({ where: { userId: In(stewardIds) } })
      : [];
    const stewardName = (userId: string | null) =>
      userId ? (stewards.find((s) => s.userId === userId)?.displayName ?? 'An agent') : null;

    const mineIds = new Set(mine.map((p) => p.id));
    // Both sides are already talking, so neither is hiding photos from the other.
    const matched = interest.status === 'accepted';

    return {
      interestId,
      status: interest.status,
      sides: [from, to].map((p) => ({
        profile: toPublicProfile(p, { matched: matched || mineIds.has(p.id) }),
        handledBy: stewardName(p.managedByUserId),
        isMine: mineIds.has(p.id),
      })),
      notes: notes.map((n) => ({
        id: n.id,
        body: n.body,
        authorProfileId: n.authorProfileId,
        mine: n.authorUserId === actor.userId,
        createdAt: n.createdAt,
      })),
    };
  }

  async post(actor: AuthUser, interestId: string, dto: PostProposalNoteDto): Promise<ProposalNote> {
    const { mine } = await this.loadSides(actor, interestId);

    // Normally the caller controls exactly one side and it is unambiguous; an
    // agent holding both sides (or an admin) has to say which they mean.
    let side = mine[0];
    if (dto.profileId) {
      const named = mine.find((p) => p.id === dto.profileId);
      if (!named) throw new ForbiddenException('That is not a side you are handling');
      side = named;
    } else if (mine.length > 1) {
      throw new ForbiddenException(
        'You are handling both sides of this match — say which one you are writing for.',
      );
    }

    return this.notes.save(
      this.notes.create({
        interestId,
        authorUserId: actor.userId,
        authorProfileId: side.id,
        body: dto.body,
      }),
    );
  }

  /** Every pairing the caller is handling that has an open conversation. */
  async myThreads(actor: AuthUser): Promise<{ interestId: string; status: string; lastNoteAt: Date | null }[]> {
    const controlled = await this.profiles.find({
      where: [{ userId: actor.userId }, { managedByUserId: actor.userId }],
    });
    if (controlled.length === 0) return [];

    const ids = controlled.map((p) => p.id);
    const interests = await this.interests.find({
      where: [{ fromProfileId: In(ids) }, { toProfileId: In(ids) }],
      order: { updatedAt: 'DESC' },
    });
    if (interests.length === 0) return [];

    const notes = await this.notes.find({
      where: { interestId: In(interests.map((i) => i.id)) },
      order: { createdAt: 'DESC' },
    });

    return interests.map((i) => ({
      interestId: i.id,
      status: i.status,
      lastNoteAt: notes.find((n) => n.interestId === i.id)?.createdAt ?? null,
    }));
  }
}
