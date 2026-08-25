import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { WeddingPlan } from './entities/wedding-plan.entity';
import { PlanTask } from './entities/plan-task.entity';
import { WeddingEvent } from '../events/entities/event.entity';
import { Guest } from '../events/entities/guest.entity';
import { EventInvite } from '../events/entities/event-invite.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import {
  BookingStatus,
  EventStatus,
  ProviderType,
  RsvpStatus,
  TaskStatus,
} from '../../common/enums';

/** Whole days from today to a date, negative once it has passed. */
function daysUntil(isoDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${isoDate}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

@Injectable()
export class WeddingDashboardService {
  constructor(
    @InjectRepository(WeddingPlan) private readonly plans: Repository<WeddingPlan>,
    @InjectRepository(PlanTask) private readonly tasks: Repository<PlanTask>,
    @InjectRepository(WeddingEvent) private readonly events: Repository<WeddingEvent>,
    @InjectRepository(Guest) private readonly guests: Repository<Guest>,
    @InjectRepository(EventInvite) private readonly invites: Repository<EventInvite>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
  ) {}

  /**
   * One screen for the whole wedding.
   *
   * Everything here already existed on a page of its own — the plan and its
   * tasks, the events, the guest list, the bookings. What did not exist was any
   * place that answered "how is it going", and answering that meant opening
   * four screens and doing arithmetic in your head.
   *
   * Assembled server-side rather than by the client fetching four endpoints and
   * joining them. The joins are the interesting part — budgeted against
   * committed, invited against replied — and a client that computes them is a
   * second implementation of rules that will drift from these.
   */
  async summary(userId: string) {
    const plan = await this.plans.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    const [events, guests, tasks] = await Promise.all([
      this.events.find({ where: { userId }, order: { eventDate: 'ASC' } }),
      this.guests.find({ where: { userId } }),
      plan ? this.tasks.find({ where: { planId: plan.id }, order: { dueDate: 'ASC' } }) : [],
    ]);

    const eventIds = events.map((e) => e.id);
    const invites = eventIds.length
      ? await this.invites.find({ where: { eventId: In(eventIds) } })
      : [];

    return {
      countdown: this.countdown(plan, events),
      budget: await this.budget(userId, events),
      guests: this.guestSummary(guests, invites),
      journey: this.journey(tasks),
      upcoming: this.upcoming(events),
    };
  }

  /**
   * How long there is left.
   *
   * The plan's wedding date is the answer when there is a plan. When there is
   * not, the earliest upcoming event stands in — a couple who added their
   * mehendi before they made a plan should still see a number, and telling them
   * "no date set" while their own calendar has one in it is the platform not
   * reading its own data.
   */
  private countdown(plan: WeddingPlan | null, events: WeddingEvent[]) {
    const next = events.find((e) => e.eventDate && e.status === EventStatus.UPCOMING);
    const date = plan?.weddingDate ?? next?.eventDate ?? null;
    if (!date) return { weddingDate: null, daysAway: null, passed: false, source: null };

    const days = daysUntil(date);
    return {
      weddingDate: date,
      daysAway: days,
      // Reported rather than hidden. A date in the past usually means somebody
      // mistyped a year, and a dashboard that silently shows nothing gives them
      // no way to notice.
      passed: days < 0,
      source: plan?.weddingDate ? 'plan' : 'event',
    };
  }

  /**
   * What the wedding is meant to cost, and what has actually been committed.
   *
   * Two different numbers from two different places, and the gap between them
   * is the only figure anybody wants. Budget is what the couple wrote against
   * each event; committed is what their bookings actually came to, grouped by
   * what the vendor does — a caterer's booking lands under catering whether or
   * not anybody remembered to budget for it.
   *
   * Cancelled bookings are excluded and requests with no agreed price count as
   * zero: a request nobody has priced is not a commitment, and counting it at
   * the buyer's hoped-for budget would make the total a wish.
   */
  private async budget(userId: string, events: WeddingEvent[]) {
    const bookings = await this.bookings.find({ where: { userId } });
    const live = bookings.filter((b) => b.status !== BookingStatus.CANCELLED);

    const vendorIds = live
      .filter((b) => b.providerType === ProviderType.VENDOR)
      .map((b) => b.providerId);
    const listings = vendorIds.length
      ? await this.vendors.find({ where: { id: In(vendorIds) } })
      : [];
    const categoryOf = new Map(listings.map((v) => [v.id, String(v.category)]));

    const rows = new Map<string, { budgeted: number; committed: number }>();
    const bump = (key: string, field: 'budgeted' | 'committed', amount: number) => {
      const row = rows.get(key) ?? { budgeted: 0, committed: 0 };
      row[field] += amount;
      rows.set(key, row);
    };

    for (const event of events) {
      if (event.budget) bump(event.category ?? 'other', 'budgeted', Number(event.budget));
    }
    for (const booking of live) {
      const key =
        booking.providerType === ProviderType.PLANNER
          ? 'planner'
          : (categoryOf.get(booking.providerId) ?? 'other');
      bump(key, 'committed', Number(booking.amount));
    }

    const categories = [...rows.entries()]
      .map(([category, row]) => ({
        category,
        budgeted: row.budgeted.toFixed(2),
        committed: row.committed.toFixed(2),
        // Negative means over. Reported as a number rather than a flag so the
        // client shows by how much, which is the part that matters.
        remaining: (row.budgeted - row.committed).toFixed(2),
      }))
      .sort((a, b) => Number(b.committed) - Number(a.committed));

    const budgeted = categories.reduce((t, c) => t + Number(c.budgeted), 0);
    const committed = categories.reduce((t, c) => t + Number(c.committed), 0);

    return {
      budgeted: budgeted.toFixed(2),
      committed: committed.toFixed(2),
      remaining: (budgeted - committed).toFixed(2),
      overBudget: committed > budgeted && budgeted > 0,
      categories,
    };
  }

  /** Invited, replied, coming — and how many people that actually is. */
  private guestSummary(guests: Guest[], invites: EventInvite[]) {
    const attending = invites.filter((i) => i.status === RsvpStatus.ATTENDING);
    const byId = new Map(guests.map((g) => [g.id, g]));
    return {
      onList: guests.length,
      invited: invites.length,
      attending: attending.length,
      declined: invites.filter((i) => i.status === RsvpStatus.DECLINED).length,
      maybe: invites.filter((i) => i.status === RsvpStatus.MAYBE).length,
      awaiting: invites.filter((i) => i.status === RsvpStatus.INVITED).length,
      /*
       * Heads, not invitations, and it takes the answer over the assumption.
       * `attendingCount` is what the family actually said when they replied;
       * `partySize` is how many were invited. A household of six that is
       * sending two is two, and catering ordered from the invitation count
       * feeds four people who are not coming.
       */
      expectedHeadcount: attending.reduce(
        (total, i) => total + (i.attendingCount ?? byId.get(i.guestId)?.partySize ?? 1),
        0,
      ),
    };
  }

  /**
   * The journey, as stages rather than as a list of tasks.
   *
   * The timeline already generates tasks with categories; this groups them so
   * the couple sees "venue: done, catering: two things left" instead of
   * forty rows they have to read.
   */
  private journey(tasks: PlanTask[]) {
    const stages = new Map<string, { total: number; done: number; nextDue: string | null }>();
    for (const task of tasks) {
      const key = task.category || 'general';
      const stage = stages.get(key) ?? { total: 0, done: 0, nextDue: null };
      stage.total += 1;
      if (task.status === TaskStatus.DONE) stage.done += 1;
      else if (task.dueDate && (!stage.nextDue || task.dueDate < stage.nextDue)) {
        stage.nextDue = task.dueDate;
      }
      stages.set(key, stage);
    }

    const done = tasks.filter((t) => t.status === TaskStatus.DONE).length;
    const overdue = tasks.filter(
      (t) => t.status !== TaskStatus.DONE && t.dueDate && daysUntil(t.dueDate) < 0,
    );

    return {
      total: tasks.length,
      done,
      percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
      overdue: overdue.length,
      // The single most useful line on the page: what is late, or what is next.
      nextUp:
        overdue[0]?.title ??
        tasks.find((t) => t.status !== TaskStatus.DONE)?.title ??
        null,
      stages: [...stages.entries()].map(([stage, s]) => ({ stage, ...s })),
    };
  }

  /** The next few things that are actually happening. */
  private upcoming(events: WeddingEvent[]) {
    return events
      .filter((e) => e.status === EventStatus.UPCOMING && e.eventDate)
      .map((e) => ({
        id: e.id,
        name: e.name,
        eventDate: e.eventDate,
        venue: e.venue,
        daysAway: daysUntil(e.eventDate as string),
        expectedGuests: e.expectedGuests,
      }))
      .filter((e) => e.daysAway >= 0)
      .slice(0, 5);
  }
}
