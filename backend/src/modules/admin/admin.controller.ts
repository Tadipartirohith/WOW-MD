import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { AdminConsoleService } from './admin-console.service';
import { AgencyService } from '../agents/agency.service';
import { AuditService } from '../../platform/audit/audit.service';
import { RejectAgencyDto } from '../agents/dto/agency.dto';
import { AuditQueryDto } from './dto/admin.dto';
import {
  AdminUserQueryDto,
  DisputeQueryDto,
  RaiseDisputeDto,
  ResolveDisputeDto,
  UpdateUserStatusDto,
} from './dto/admin.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';
import { BookingsService } from '../bookings/bookings.service';
import {
  ActivityQueryDto,
  AdminBookingQueryDto,
  DirectoryQueryDto,
  ReportQueryDto,
} from './dto/console.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly agency: AgencyService,
    private readonly audit: AuditService,
    private readonly bookings: BookingsService,
    private readonly console: AdminConsoleService,
  ) {}

  // ---------------------------------------------------------- the console
  //
  // One admin page could show approvals, analytics and disputes. What it could
  // not do was answer a question about a particular account, a particular
  // business or a particular booking — which is how every real admin session
  // starts, because somebody has complained about something specific.

  @RequirePermissions(Permission.ADMIN_ANALYTICS_READ)
  @ApiOperation({
    summary: 'What has been happening, across the platform',
    description:
      'Not the audit trail. That records privileged actions — who approved what, who moved ' +
      'money. This is the ordinary life of the platform: sign-ups, listings, bookings, ' +
      'complaints. Assembled from the newest rows of each source rather than by a union.',
  })
  @Get('activity')
  activity(@Query() q: ActivityQueryDto) {
    return this.console.activity(q);
  }

  @RequirePermissions(Permission.ADMIN_USERS_READ)
  @ApiOperation({
    summary: 'The accounts directory, searchable and filterable by state',
    description: 'Suspended accounts are the ones people arrive looking for.',
  })
  @Get('directory')
  directory(@Query() q: DirectoryQueryDto) {
    return this.console.directory(q);
  }

  @RequirePermissions(Permission.ADMIN_USERS_READ)
  @ApiOperation({
    summary: 'One account, and everything hanging off it',
    description:
      'Profiles, businesses, bookings, cases raised and cases assigned, in one read. The ' +
      'alternative is filtering six lists by a uuid, which is how the wrong account gets ' +
      'suspended. Password and MFA columns are never selected.',
  })
  @Get('accounts/:id')
  accountDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.console.accountDetail(id);
  }

  @RequirePermissions(Permission.ADMIN_USERS_READ)
  @ApiOperation({
    summary: 'Administrators and field officers, listed apart',
    description:
      'They are not variants of one thing. One decides who gets access; the other goes to an ' +
      'address and writes down what they saw — and only the second has a workload.',
  })
  @Get('staff/:kind')
  staff(@Param('kind') kind: 'admin' | 'in_person') {
    return this.console.staff(kind === 'admin' ? 'admin' : 'in_person');
  }

  @RequirePermissions(Permission.ADMIN_VENDOR_APPROVE)
  @ApiOperation({
    summary: 'Every business on the platform, by lifecycle state',
    description:
      'Businesses, not vendor accounts — one account can hold several, and "how many listings ' +
      'are stuck in first review" is a question about the listings.',
  })
  @Get('businesses')
  businesses(@Query() q: DirectoryQueryDto) {
    return this.console.businesses(q);
  }

  @RequirePermissions(Permission.ADMIN_ANALYTICS_READ)
  @ApiOperation({
    summary: 'Every booking, across all stages',
    description:
      'A vendor sees their incoming work and a buyer their own; nobody could see the whole ' +
      'book. That is where a dispute starts, and it is the only way to notice forty bookings ' +
      'sitting unpaid for a fortnight.',
  })
  @Get('bookings')
  allBookings(@Query() q: AdminBookingQueryDto) {
    return this.console.allBookings(q);
  }

  @RequirePermissions(Permission.ADMIN_ANALYTICS_READ)
  @ApiOperation({
    summary: 'Reports over a window: users, agents, vendors, bookings, financial, verification',
    description:
      'One route rather than six, because they differ only in which counts they ask for and ' +
      'all six want the same window handled the same way. Defaults to the last thirty days — ' +
      'a report with no window means "everything ever", which reads as a catastrophic month.',
  })
  @Get('reports')
  report(@Query() q: ReportQueryDto) {
    return this.console.report(q);
  }

  // -------------------------------------------------------- agency vetting

  /**
   * Agents can build profiles and invite real people to create accounts, so an
   * unvetted agent is the highest-leverage account type on the platform. These
   * two routes are the gate.
   */
  @RequirePermissions(Permission.ADMIN_AGENT_APPROVE)
  @Get('agents/pending')
  pendingAgents() {
    return this.agency.listPending();
  }

  @RequirePermissions(Permission.ADMIN_AGENT_APPROVE)
  @Put('agents/:id/approve')
  approveAgent(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.agency.approve(actor, id);
  }

  @RequirePermissions(Permission.ADMIN_AGENT_APPROVE)
  @Put('agents/:id/reject')
  rejectAgent(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectAgencyDto,
  ) {
    return this.agency.reject(actor, id, dto.reason);
  }

  // ------------------------------------------------------------- audit trail

  @RequirePermissions(Permission.ADMIN_AUDIT_READ)
  @ApiOperation({ summary: 'Append-only trail of privileged and money-moving actions' })
  @Get('audit')
  auditLog(@Query() q: AuditQueryDto) {
    return this.audit.list(q.page, q.limit, {
      action: q.action,
      actorUserId: q.actorUserId,
      resourceId: q.resourceId,
    });
  }

  @RequirePermissions(Permission.ADMIN_USERS_READ)
  @Get('users')
  users(@Query() q: AdminUserQueryDto) {
    return this.admin.listUsers(q.page, q.limit, q.role);
  }

  @RequirePermissions(Permission.ADMIN_USERS_READ)
  @ApiOperation({ summary: 'Suspend or reinstate any account' })
  @Put('users/:id/status')
  setUserStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserStatusDto) {
    return this.admin.setUserStatus(id, dto);
  }

  @RequirePermissions(Permission.ADMIN_VENDOR_APPROVE)
  @Get('vendors/pending')
  pendingVendors() {
    return this.admin.listPendingVendors();
  }

  /**
   * Deliberately absent: there is no route that approves a vendor listing.
   *
   * A listing is activated by the officer who visited the registered address,
   * through `PUT /verification/requests/:id/decide`. Leaving an administrative
   * shortcut here would make the visit optional, which is the one thing the
   * whole verification flow exists to prevent.
   */

  @RequirePermissions(Permission.ADMIN_VENDOR_APPROVE)
  @Get('planners/pending')
  pendingPlanners() {
    return this.admin.listPendingPlanners();
  }

  @RequirePermissions(Permission.ADMIN_VENDOR_APPROVE)
  @Put('planners/:id/approve')
  approvePlanner(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.approvePlanner(id);
  }

  /**
   * Pays out what the platform owes but could not move.
   *
   * Runs nightly on its own; this is the same sweep on demand, for when a
   * provider rings up to say their onboarding has cleared and they would like
   * their money today rather than tomorrow.
   */
  @RequirePermissions(Permission.ADMIN_ANALYTICS_READ)
  @ApiOperation({ summary: 'Retry payouts that had nowhere to go' })
  @HttpCode(200)
  @Post('payouts/retry')
  retryPayouts() {
    return this.bookings.retryPendingPayouts();
  }

  @RequirePermissions(Permission.ADMIN_ANALYTICS_READ)
  @Get('analytics')
  analytics() {
    return this.admin.analytics();
  }

  @RequirePermissions(Permission.ADMIN_DISPUTE_RESOLVE)
  @Get('disputes')
  disputes(@Query() q: DisputeQueryDto) {
    return this.admin.listDisputes(q.status);
  }

  @RequirePermissions(Permission.ADMIN_DISPUTE_RESOLVE)
  @Put('disputes/:id/resolve')
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveDisputeDto) {
    return this.admin.resolveDispute(id, dto);
  }

  /** Any party to a booking may raise a dispute on it. */
  @RequirePermissions(Permission.DISPUTE_RAISE)
  @Post('disputes')
  raise(@CurrentUser() actor: AuthUser, @Body() dto: RaiseDisputeDto) {
    return this.admin.raiseDispute(actor, dto);
  }
}
