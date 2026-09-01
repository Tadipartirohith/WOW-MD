import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BookingStatus, ProviderType } from '../../../common/enums';

@Entity('bookings')
@Index(['providerType', 'providerId'])
export class Booking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The client the booking is *for*. Escrow refunds go back to this account. */
  @Index()
  @Column('uuid')
  userId: string;

  /**
   * Who actually placed it. Equals `userId` for a self-service booking; for an
   * agent booking on a client's behalf this is the agent, giving a clean audit
   * trail of who acted.
   */
  @Index()
  @Column('uuid')
  bookedByUserId: string;

  /** Which directory the provider lives in. */
  @Column({ type: 'enum', enum: ProviderType, default: ProviderType.VENDOR })
  providerType: ProviderType;

  /** Vendor.id or PlannerProfile.id, depending on providerType. */
  @Index()
  @Column('uuid')
  providerId: string;

  @Index()
  @Column({ type: 'enum', enum: BookingStatus, default: BookingStatus.REQUESTED })
  status: BookingStatus;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  amount: string;

  @Column({ default: 'INR' })
  currency: string;

  @Column({ type: 'date', nullable: true })
  eventDate: string | null;

  /**
   * The published window this booking holds.
   *
   * A booking without one is a legacy row or a planner engagement; for a vendor
   * the slot is what stops the same afternoon being sold twice.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  slotId: string | null;

  /** The wedding event this is for — the reception, the mehendi. */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  eventId: string | null;

  /**
   * What the buyer actually needs: guest count, menu, timings, anything the
   * provider must know to price the job. Mandatory on a vendor request, because
   * a quotation written without it is a guess.
   */
  @Column({ type: 'text', nullable: true })
  requirements: string | null;

  // ------------------------------------------------------------ the catalog
  //
  // Which service was booked, at which published price, and the answers to
  // that service's booking form. All three are nullable: a booking made before
  // the catalog existed has no service to point at and must keep loading.

  @Index()
  @Column({ type: 'uuid', nullable: true })
  vendorServiceId: string | null;

  @Column({ type: 'uuid', nullable: true })
  offeringId: string | null;

  /**
   * The buyer's answers to the service's BOOKING-scope attributes, validated
   * against them at request time.
   *
   * Structured, unlike `requirements` above, which stays because a buyer
   * always has something to say that no form thought to ask.
   */
  @Column({ type: 'jsonb', default: {} })
  serviceAnswers: Record<string, unknown>;

  /** Plates, hours, days — whatever the offering's pricing model counts. */
  @Column({ type: 'int', nullable: true })
  quantity: number | null;

  /**
   * What the buyer hopes to spend. Optional on purpose — the provider quotes
   * against the requirements, and forcing a number out of someone who does not
   * have one only produces a fictional one.
   */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  expectedBudget: string | null;

  /** Set when the provider confirms they have started. */
  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  /** Set when the provider says the work is delivered. */
  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'text', nullable: true })
  cancellationReason: string | null;

  /**
   * The quotation this booking was struck on, if it came through one.
   *
   * Points at a row that is never edited in place, which is what makes the
   * agreed price and terms reconstructable months later when somebody argues
   * about them.
   */
  @Column({ type: 'uuid', nullable: true })
  acceptedQuotationId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  /*
   * Filled in when a provider's queue is listed, and never stored.
   *
   * All of it lives on the client, the event and the payments already; a
   * stored copy would be stale the moment a couple renamed their reception.
   * They are here so a booking row can be answered without opening three
   * other screens.
   */
  clientName?: string | null;
  clientEmail?: string | null;
  clientPhone?: string | null;
  eventName?: string | null;
  eventVenue?: string | null;
  eventCity?: string | null;
  expectedGuests?: number | null;
  serviceName?: string | null;
  /** The furthest this booking's money has got, not a list of transactions. */
  paymentStatus?: string | null;
}
