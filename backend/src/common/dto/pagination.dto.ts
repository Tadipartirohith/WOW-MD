import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Bounds come from the environment so operators can retune paging without a
 * code change, which is what PAGINATION_DEFAULT_LIMIT / PAGINATION_MAX_LIMIT
 * were always meant to do — previously they were read into config and then
 * ignored in favour of hard-coded numbers here.
 *
 * Read once at module load: decorators are evaluated at class-definition time,
 * long before Nest's DI container exists, so AppConfigService is not reachable.
 */
const DEFAULT_LIMIT = Number(process.env.PAGINATION_DEFAULT_LIMIT) || 20;
const MAX_LIMIT = Number(process.env.PAGINATION_MAX_LIMIT) || 100;

/**
 * Shared pagination input. Bounds come from config at read time in services;
 * these validators enforce sane hard caps at the edge.
 */
export class PaginationDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: DEFAULT_LIMIT, minimum: 1, maximum: MAX_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT, { message: `limit cannot exceed ${MAX_LIMIT}` })
  limit = DEFAULT_LIMIT;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

export interface PaginatedResult<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export function paginate<T>(data: T[], total: number, page: number, limit: number): PaginatedResult<T> {
  return {
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  };
}
