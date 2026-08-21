import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FamilyType, MaritalStatus, OccupationStatus } from '../../../common/enums';

/**
 * The matrimonial biodata behind a profile.
 *
 * Kept in its own table rather than bolted onto `profiles` for two reasons. The
 * matching engine and every listing query touch `profiles` constantly and have
 * no use for sixty more columns; and this is the sensitive half — income,
 * horoscope, family assets — so keeping it separate turns "who may read what"
 * into a question about a table rather than about a column list.
 *
 * The sections mirror the intake form exactly. Fields the platform filters or
 * matches on are real columns; the rest travel as grouped JSON, because they
 * are displayed as a block and never queried individually.
 */
@Entity('profile_details')
export class ProfileDetails {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column('uuid')
  profileId: string;

  // ------------------------------------------------------------- personal

  @Column({ type: 'varchar', length: 80, nullable: true })
  firstName: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  surname: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  lastName: string | null;

  /** Centimetres. A number, so "at least 165" is a comparison and not a parse. */
  @Index()
  @Column({ type: 'int', nullable: true })
  heightCm: number | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  complexion: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  nativePlace: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  placeOfBirth: string | null;

  @Column({ type: 'text', nullable: true })
  communicationAddress: string | null;

  /** A second number, for the family rather than the person. Optional. */
  @Column({ type: 'varchar', nullable: true })
  alternateMobile: string | null;

  /** Country, state, district, mandal, village — where they live now. */
  @Column({ type: 'jsonb', default: {} })
  residence: Record<string, string>;

  // ------------------------------------------------------------- religion

  @Index()
  @Column({ type: 'varchar', length: 60, nullable: true })
  religion: string | null;

  @Index()
  @Column({ type: 'varchar', length: 60, nullable: true })
  caste: string | null;

  @Index()
  @Column({ type: 'varchar', length: 60, nullable: true })
  subCaste: string | null;

  @Index()
  @Column({ type: 'varchar', length: 60, nullable: true })
  motherTongue: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  denomination: string | null;

  // ------------------------------------------------------------ horoscope

  /**
   * Null until somebody answers. "We do not keep one" is a real answer that
   * completes this section; never having been asked is not, and a column that
   * defaults to false cannot tell the two apart.
   */
  @Column({ type: 'boolean', nullable: true })
  horoscopeAvailable: boolean | null;

  /**
   * Rashi, star, padam, gothram, kuja dosham, time of birth and the birthplace
   * breakdown. One block because it is read as one, and because a family that
   * does not use horoscopes leaves all of it empty.
   */
  @Column({ type: 'jsonb', default: {} })
  horoscope: Record<string, unknown>;

  /** An uploaded chart, where there is one. */
  @Column({ type: 'varchar', nullable: true })
  horoscopeDocumentUrl: string | null;

  // -------------------------------------------------------------- marital

  @Index()
  @Column({ type: 'enum', enum: MaritalStatus, nullable: true })
  maritalStatus: MaritalStatus | null;

  /**
   * Marriage, divorce and separation dates, years married, children. Only
   * meaningful when the status is not "never married", and hidden entirely
   * when it is.
   */
  @Column({ type: 'jsonb', default: {} })
  maritalHistory: Record<string, unknown>;

  // --------------------------------------------------------------- family

  @Column({ type: 'jsonb', default: {} })
  father: Record<string, unknown>;

  @Column({ type: 'jsonb', default: {} })
  mother: Record<string, unknown>;

  @Column({ type: 'enum', enum: FamilyType, nullable: true })
  familyType: FamilyType | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  familyStatus: string | null;

  @Column({ type: 'int', nullable: true })
  brothers: number | null;

  @Column({ type: 'int', nullable: true })
  sisters: number | null;

  // ------------------------------------------------- education and career

  @Index()
  @Column({ type: 'varchar', length: 120, nullable: true })
  highestQualification: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  course: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  institution: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  collegePlace: string | null;

  @Index()
  @Column({ type: 'enum', enum: OccupationStatus, nullable: true })
  occupationStatus: OccupationStatus | null;

  /** Company, designation, role, office and work location — when employed. */
  @Column({ type: 'jsonb', default: {} })
  employment: Record<string, unknown>;

  /** Business name, income and location — when self-employed. */
  @Column({ type: 'jsonb', default: {} })
  business: Record<string, unknown>;

  /**
   * Income is the field people are least willing to publish, so it carries its
   * own visibility rather than riding on the profile's.
   */
  @Column({ type: 'boolean', default: false })
  incomeVisible: boolean;

  // --------------------------------------------------- partner preferences

  @Column({ type: 'int', nullable: true })
  preferredAgeMin: number | null;

  @Column({ type: 'int', nullable: true })
  preferredAgeMax: number | null;

  @Column({ type: 'int', nullable: true })
  preferredHeightMinCm: number | null;

  @Column({ type: 'int', nullable: true })
  preferredHeightMaxCm: number | null;

  /**
   * Religion, caste, education, profession, complexion and the locations they
   * will consider, plus free-text expectations.
   */
  @Column({ type: 'jsonb', default: {} })
  partnerPreferences: Record<string, unknown>;

  // ---------------------------------------------------------------- media

  /** The photo shown first. One of `profiles.photos`. */
  @Column({ type: 'varchar', nullable: true })
  primaryPhotoUrl: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
