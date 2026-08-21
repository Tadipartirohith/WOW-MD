import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AdminService } from './admin.service';
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

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly agency: AgencyService,
    private readonly audit: AuditService,
  ) {}

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
