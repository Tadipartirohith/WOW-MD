import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AttributeScope, ServiceAttributeType } from '../../../common/enums';

/** Bounds and choices, kept together because they are all optional per type. */
export interface AttributeConstraints {
  /** SINGLE_SELECT / MULTI_SELECT. */
  options?: { value: string; label: string }[];
  /** NUMBER / DECIMAL / CURRENCY / DURATION / RANGE. */
  min?: number;
  max?: number;
  /** DECIMAL — how many places the answer is stored to. */
  precision?: number;
  /** TEXT. */
  maxLength?: number;
  /** MULTI_SELECT — how many may be chosen. */
  minSelections?: number;
  maxSelections?: number;
  /** DURATION — minutes, hours or days. Purely a display and parse hint. */
  unit?: 'minutes' | 'hours' | 'days';
  /** FILE. */
  accept?: string[];
}

/**
 * One question in the catalog.
 *
 * Two scopes share this table because they are the same shape and the same
 * validator: SERVICE attributes describe what the vendor offers, BOOKING
 * attributes are what the buyer is asked. Splitting them into two tables would
 * duplicate fifteen type validators to no benefit.
 */
@Entity('service_attributes')
@Index(['definitionId', 'scope', 'key'], { unique: true })
export class ServiceAttribute {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  definitionId: string;

  @Index()
  @Column({ type: 'enum', enum: AttributeScope })
  scope: AttributeScope;

  /** The key the answer is stored under. Stable; the label is not. */
  @Column({ type: 'varchar', length: 60 })
  key: string;

  @Column({ type: 'varchar', length: 140 })
  label: string;

  @Column({ type: 'text', nullable: true })
  helpText: string | null;

  @Column({ type: 'enum', enum: ServiceAttributeType })
  type: ServiceAttributeType;

  @Column({ default: false })
  required: boolean;

  @Column({ type: 'jsonb', default: {} })
  constraints: AttributeConstraints;

  /**
   * Whether buyers can filter the directory on this answer.
   *
   * Only meaningful for SERVICE attributes, and only worth setting on the two
   * or three that people actually search by — every filterable attribute is a
   * jsonb containment query against the listing.
   */
  @Column({ default: false })
  filterable: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
