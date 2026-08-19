import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AdminService } from './admin.service';
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
  constructor(private readonly admin: AdminService) {}

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

  @RequirePermissions(Permission.ADMIN_VENDOR_APPROVE)
  @Put('vendors/:id/approve')
  approveVendor(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.approveVendor(id);
  }

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
