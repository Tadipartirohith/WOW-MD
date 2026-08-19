import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EmailTokenType } from '../../../common/enums';

/** Single-use, hashed tokens for email verification and password reset. */
@Entity('email_tokens')
export class EmailToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Index()
  @Column({ type: 'enum', enum: EmailTokenType })
  type: EmailTokenType;

  @Index({ unique: true })
  @Column()
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
