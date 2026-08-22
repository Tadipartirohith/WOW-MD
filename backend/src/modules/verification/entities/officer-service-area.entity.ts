import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * Where one verification officer will actually travel.
 *
 * Allocation used to rank purely on how much work somebody was already
 * carrying, which is fine until the lightest-loaded officer is four hundred
 * kilometres from the business they have been sent to visit. Recording a
 * region on the officer and hoping the strings matched would have been worse
 * than ignoring geography, because a near-miss ("Hyderabad" against
 * "hyderabad, telangana") reads as *no* coverage and quietly sends the visit
 * to the wrong person.
 *
 * So coverage is rows rather than a field, at two granularities:
 *
 * - a **city**, which is how almost every real assignment is expressed, and
 * - a **state**, for an officer who genuinely covers a whole one.
 *
 * Both are normalised on the way in — lowercased, trimmed, punctuation and
 * inner whitespace collapsed — because the alternative is matching free text
 * typed by two different administrators on two different days.
 */
@Entity('officer_service_areas')
@Unique(['officerUserId', 'city', 'state'])
export class OfficerServiceArea {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  officerUserId: string;

  /**
   * Normalised city. Null means the row covers a whole state.
   *
   * The original spelling is kept alongside so an administrator sees what they
   * typed rather than the normalised form.
   */
  @Index()
  @Column({ type: 'varchar', length: 120, nullable: true })
  city: string | null;

  @Index()
  @Column({ type: 'varchar', length: 120, nullable: true })
  state: string | null;

  /** What the administrator actually typed, for display. */
  @Column({ type: 'varchar', length: 200 })
  label: string;

  /**
   * A city an officer covers reluctantly — a neighbouring district they will
   * travel to when nobody nearer is free. Ranked below a primary area so the
   * obvious allocation still wins when it is available.
   */
  @Column({ type: 'boolean', default: true })
  primary: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
