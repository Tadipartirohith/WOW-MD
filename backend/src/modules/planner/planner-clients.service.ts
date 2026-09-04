import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { WeddingPlan } from './entities/wedding-plan.entity';
import { PlanTask } from './entities/plan-task.entity';
import { WeddingDashboardService } from './wedding-dashboard.service';
import { User } from '../auth/entities/user.entity';
import { Profile } from '../users/entities/profile.entity';
import { WeddingEvent } from '../events/entities/event.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { BookingStatus, ProviderType, TaskStatus, UserRole } from '../../common/enums';

/**
 * The weddings a planner was hired to run.
 *
 * A planner's own Events page lists their own days, of which there are none —
 * they are not the one getting married. What they need is the other people's
 * weddings they are responsible for, and until now the only route to any of it
 * was the plan timeline, one plan at a time, with no way to see who the client
 * actually is.
 *
 * Engagement is read from WeddingPlan.plannerUserId throughout, never invented
 * here. engagePlanner only sets it against a confirmed or completed booking, so
 * it is already the platform's answer to "is this planner working for this
 * couple"; a second definition would eventually disagree with the first.
 */
@Injectable()
export class PlannerClientsService {
  constructor(
    @InjectRepository(WeddingPlan) private readonly plans: Repository<WeddingPlan>,
    @InjectRepository(PlanTask) private readonly tasks: Repository<PlanTask>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(WeddingEvent) private readonly events: Repository<WeddingEvent>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(PlannerProfile)
    private readonly plannerProfiles: Repository<PlannerProfile>,
    private readonly dashboard: WeddingDashboardService,
  ) {}

  /**
   * Where a wedding has got to.
   *
   * Derived from the date and the tasks, because nothing in the model records
   * a status directly. `cancelled` is deliberately not among the answers: the
   * schema has no way to cancel a wedding plan, and inventing the state here
   * would put a filter on the screen that can never match anything.
   */
  private lifecycle(weddingDate: string | null, tasks: PlanTask[]): 'active' | 'upcoming' | 'completed' {
    if (weddingDate && new Date(weddingDate) < new Date()) return 'completed';
    const started = tasks.some((t) => t.status !== TaskStatus.PENDING);
    return started ? 'active' : 'upcoming';
  }

  /**
   * Naming the two people, from whichever field actually carries it.
   *
   * Gender was the obvious signal and is the wrong one: most profiles do not
   * set it — 338 of them here against 314 that do — and one of the ones that
   * does spells it "Male". The account's role is chosen at registration and is
   * always present, so it leads, and gender is used only to name a second
   * person the account holder manages.
   *
   * A partner with no account of their own simply has no name to show, which
   * is the truth rather than a blank pretending to be a missing field.
   */
  private couple(
    role: UserRole | null,
    profiles: Profile[],
  ): { bride: string | null; groom: string | null } {
    const holder = profiles[0]?.displayName ?? null;
    const byGender = (g: string) =>
      profiles.slice(1).find((p) => (p.gender ?? '').toLowerCase() === g)?.displayName ?? null;

    if (role === UserRole.BRIDE) return { bride: holder, groom: byGender('male') };
    if (role === UserRole.GROOM) return { bride: byGender('female'), groom: holder };
    // A family member holds the account for somebody else, so neither name is
    // theirs; both come from the profiles they manage.
    return {
      bride: profiles.find((p) => (p.gender ?? '').toLowerCase() === 'female')?.displayName ?? null,
      groom: profiles.find((p) => (p.gender ?? '').toLowerCase() === 'male')?.displayName ?? null,
    };
  }

  /** The plans this planner is engaged on, or a refusal. */
  private async engagedPlans(actor: AuthUser): Promise<WeddingPlan[]> {
    if (actor.role !== UserRole.PLANNER && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only a wedding planner has clients here');
    }
    return this.plans.find({
      where: actor.role === UserRole.ADMIN ? {} : { plannerUserId: actor.userId },
      order: { weddingDate: 'ASC' },
    });
  }

  /**
   * One row per client, with enough on it to choose between them.
   *
   * Everything expensive is fetched once for the whole list rather than per
   * row: a planner with thirty weddings would otherwise make a hundred and
   * fifty queries to draw one table.
   */
  async listClients(actor: AuthUser) {
    const plans = await this.engagedPlans(actor);
    if (plans.length === 0) return { clients: [], requests: await this.openRequests(actor) };

    const hostIds = [...new Set(plans.map((p) => p.userId))];
    const [users, profiles, events, tasks, bookings] = await Promise.all([
      this.users.find({ where: { id: In(hostIds) }, select: ['id', 'email', 'phone', 'role'] }),
      this.profiles.find({ where: { userId: In(hostIds) } }),
      this.events.find({ where: { userId: In(hostIds) }, order: { eventDate: 'ASC' } }),
      this.tasks.find({ where: { planId: In(plans.map((p) => p.id)) } }),
      // The client's bookings, so the card can carry where each wedding's
      // spending has got to, not only its tasks (EZ1-I7).
      this.bookings.find({ where: { userId: In(hostIds) } }),
    ]);

    const userById = new Map(users.map((u) => [u.id, u]));
    const profilesByUser = new Map<string, Profile[]>();
    for (const p of profiles) {
      if (!p.userId) continue;
      profilesByUser.set(p.userId, [...(profilesByUser.get(p.userId) ?? []), p]);
    }

    const clients = plans.map((plan) => {
      const user = userById.get(plan.userId);
      const own = profilesByUser.get(plan.userId) ?? [];
      const mine = events.filter((e) => e.userId === plan.userId);
      const planTasks = tasks.filter((t) => t.planId === plan.id);
      const next = mine.find((e) => e.eventDate && new Date(e.eventDate) >= new Date());

      const { bride, groom } = this.couple(user?.role ?? null, own);

      // A booking is "confirmed" once the vendor has taken the job; anything
      // earlier (requested, quoted, accepted) is still being negotiated.
      const clientBookings = bookings.filter((b) => b.userId === plan.userId);
      const confirmed = clientBookings.filter((b) =>
        [BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS, BookingStatus.COMPLETED].includes(
          b.status,
        ),
      ).length;
      const pendingBookings = clientBookings.length - confirmed;

      return {
        userId: plan.userId,
        planId: plan.id,
        name: own[0]?.displayName ?? user?.email ?? 'A client',
        bride,
        groom,
        email: user?.email ?? null,
        phone: user?.phone ?? null,
        weddingDate: plan.weddingDate ?? null,
        location: next?.city ?? mine[0]?.city ?? own[0]?.city ?? null,
        events: mine.length,
        nextEvent: next ? { id: next.id, name: next.name, date: next.eventDate } : null,
        tasks: {
          total: planTasks.length,
          done: planTasks.filter((t) => t.status === TaskStatus.DONE).length,
        },
        bookings: {
          total: clientBookings.length,
          confirmed,
          pending: pendingBookings,
        },
        status: this.lifecycle(plan.weddingDate ?? null, planTasks),
      };
    });

    return { clients, requests: await this.openRequests(actor) };
  }

  /**
   * Work waiting on an answer.
   *
   * A booking a couple has asked for and the planner has not yet responded to.
   * It belongs on this page because that is where a planner looks for "what is
   * mine", and a request sitting unanswered in a different screen is how a
   * client concludes nobody is there.
   */
  private async openRequests(actor: AuthUser) {
    if (actor.role !== UserRole.PLANNER) return [];
    const rows = await this.bookings.find({
      where: {
        providerType: ProviderType.PLANNER,
        status: BookingStatus.REQUESTED,
      },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    // The provider id on a planner booking is the planner *profile*, not the
    // user, so the rows are narrowed by ownership after the fact.
    const mine = await this.plannerProfiles.find({
      where: { ownerUserId: actor.userId },
      select: ['id'],
    });
    const ids = new Set(mine.map((p) => p.id));
    const requests = rows.filter((b) => ids.has(b.providerId));

    // Who is asking, by name — a request the planner cannot put a name to reads
    // as noise, and the My Clients page is where they decide whether to take it
    // on (EZ1-I56).
    const userIds = [...new Set(requests.map((b) => b.userId))];
    const [profiles, users] = await Promise.all([
      userIds.length ? this.profiles.find({ where: { userId: In(userIds) } }) : Promise.resolve([]),
      userIds.length ? this.users.find({ where: { id: In(userIds) } }) : Promise.resolve([]),
    ]);
    const nameOf = (uid: string) =>
      profiles.find((p) => p.userId === uid)?.displayName ??
      users.find((u) => u.id === uid)?.email ??
      'A couple';

    return requests.map((b) => ({
      bookingId: b.id,
      userId: b.userId,
      name: nameOf(b.userId),
      amount: b.amount,
      currency: b.currency,
      requestedAt: b.createdAt,
    }));
  }

  /**
   * Everything about one client, on one screen.
   *
   * The budget, guest counts and planning progress are not recomputed here:
   * WeddingDashboardService already derives them for the couple's own
   * dashboard, and a planner looking at the same wedding must be shown the
   * same numbers. Two implementations of "what has this wedding committed"
   * would disagree, and the planner's copy is the one nobody would notice
   * drifting.
   */
  async clientDetail(actor: AuthUser, clientUserId: string) {
    const plan = await this.plans.findOne({
      where:
        actor.role === UserRole.ADMIN
          ? { userId: clientUserId }
          : { userId: clientUserId, plannerUserId: actor.userId },
      order: { createdAt: 'DESC' },
    });
    if (!plan) throw new NotFoundException('You are not engaged on that wedding');

    const [user, profiles, events, tasks, bookings, summary] = await Promise.all([
      this.users.findOne({
        where: { id: clientUserId },
        // `role` is what names the bride or the groom — see couple(). Leaving
        // it out of the select made this page show a dash where the list
        // beside it showed a name, off the same data.
        select: ['id', 'email', 'phone', 'createdAt', 'role'],
      }),
      this.profiles.find({ where: { userId: clientUserId } }),
      this.events.find({ where: { userId: clientUserId }, order: { eventDate: 'ASC' } }),
      this.tasks.find({ where: { planId: plan.id }, order: { dueDate: 'ASC' } }),
      this.bookings.find({ where: { userId: clientUserId }, order: { createdAt: 'DESC' } }),
      this.dashboard.summary(clientUserId),
    ]);

    const vendorIds = bookings
      .filter((b) => b.providerType === ProviderType.VENDOR)
      .map((b) => b.providerId);
    const listings = vendorIds.length
      ? await this.vendors.find({ where: { id: In(vendorIds) } })
      : [];
    const vendorById = new Map(listings.map((v) => [v.id, v]));

    const { bride, groom } = this.couple(user?.role ?? null, profiles);

    return {
      client: {
        userId: clientUserId,
        name: profiles[0]?.displayName ?? user?.email ?? 'A client',
        bride,
        groom,
        email: user?.email ?? null,
        phone: user?.phone ?? null,
        city: profiles[0]?.city ?? null,
        since: user?.createdAt ?? null,
        status: this.lifecycle(plan.weddingDate ?? null, tasks),
      },
      wedding: {
        planId: plan.id,
        weddingDate: plan.weddingDate ?? null,
        countdown: summary.countdown,
        functions: events.length,
        venues: [...new Set(events.map((e) => e.venue).filter(Boolean))],
        cities: [...new Set(events.map((e) => e.city).filter(Boolean))],
      },
      /** Spec section 3, and the couple's own journey view — one derivation. */
      progress: summary.journey,
      guests: summary.guests,
      budget: summary.budget,
      events: events.map((e) => ({
        id: e.id,
        name: e.name,
        date: e.eventDate,
        venue: e.venue,
        city: e.city,
        startTime: e.startTime,
        budget: e.budget,
        status: e.status,
      })),
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        category: t.category,
        dueDate: t.dueDate,
        status: t.status,
      })),
      /** Spec section 6: who has been booked, and where each stands. */
      vendors: bookings.map((b) => {
        const listing = b.providerType === ProviderType.VENDOR ? vendorById.get(b.providerId) : null;
        return {
          bookingId: b.id,
          name: listing?.name ?? (b.providerType === ProviderType.PLANNER ? 'Planning' : 'Provider'),
          category: listing?.category ?? b.providerType,
          status: b.status,
          amount: b.amount,
          currency: b.currency,
          eventDate: b.eventDate ?? null,
        };
      }),
    };
  }
}
