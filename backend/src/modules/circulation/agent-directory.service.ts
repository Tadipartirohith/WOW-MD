import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { AgentProfile } from '../agents/entities/agent-profile.entity';
import { AgentDirectoryDto } from './dto/sharing.dto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';

/** What one agent may see of another. Deliberately business details only. */
export interface AgentDirectoryEntry {
  userId: string;
  agencyName: string;
  city: string | null;
  about: string | null;
}

/**
 * The list of agencies an agent can circulate to.
 *
 * Only approved agencies appear, and only their business details — an agent
 * needs to know who they are sending a client's biodata to, and nothing more.
 * The caller never sees themselves.
 */
@Injectable()
export class AgentDirectoryService {
  constructor(
    @InjectRepository(AgentProfile) private readonly agencies: Repository<AgentProfile>,
  ) {}

  async list(actor: AuthUser, q: AgentDirectoryDto): Promise<PaginatedResult<AgentDirectoryEntry>> {
    const qb = this.agencies
      .createQueryBuilder('a')
      .where('a."isApproved" = true')
      .andWhere('a."ownerUserId" != :me', { me: actor.userId });

    if (q.q) {
      const term = `%${q.q.toLowerCase()}%`;
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('LOWER(a."agencyName") LIKE :term', { term })
            .orWhere('LOWER(a.city) LIKE :term', { term }),
        ),
      );
    }

    qb.orderBy('a."agencyName"', 'ASC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);

    const [rows, total] = await qb.getManyAndCount();
    const data = rows.map((a) => ({
      userId: a.ownerUserId,
      agencyName: a.agencyName,
      city: a.city ?? null,
      about: a.about ?? null,
    }));
    return paginate(data, total, q.page, q.limit);
  }
}
