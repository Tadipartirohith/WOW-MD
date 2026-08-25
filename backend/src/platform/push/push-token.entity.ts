import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A device somebody has agreed to be reached on.
 *
 * Unique on the token rather than on (user, token): a phone that changes hands,
 * or an account signed out of and into on the same device, produces the same
 * registration token under a new owner — and a row per owner would send that
 * person somebody else's notifications.
 */
@Entity('push_tokens')
@Unique(['token'])
export class PushToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'varchar', length: 512 })
  token: string;

  /** `android`, `ios` or `web`. Recorded for diagnosis, not for routing. */
  @Column({ type: 'varchar', length: 16, default: 'web' })
  platform: string;

  /**
   * When this device last proved it exists.
   *
   * Tokens go stale silently — an app uninstalled is a token that fails
   * forever — so a sweep can drop the ones nothing has touched in months
   * without waiting for a send to tell it.
   */
  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
