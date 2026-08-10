import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { PaymentStatus } from '../../../common/enums';

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  bookingId: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  @Column({ default: 'INR' })
  currency: string;

  @Index()
  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.INITIATED })
  status: PaymentStatus;

  @Column()
  provider: string;

  @Column({ type: 'varchar', nullable: true })
  providerRef: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
