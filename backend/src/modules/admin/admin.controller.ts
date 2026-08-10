import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { RaiseDisputeDto, ResolveDisputeDto } from './dto/admin.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DisputeStatus, UserRole } from '../../common/enums';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Roles(UserRole.ADMIN)
  @Get('users')
  users() {
    return this.admin.listUsers();
  }

  @Roles(UserRole.ADMIN)
  @Get('vendors/pending')
  pendingVendors() {
    return this.admin.listPendingVendors();
  }

  @Roles(UserRole.ADMIN)
  @Put('vendors/:id/approve')
  approveVendor(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.approveVendor(id);
  }

  @Roles(UserRole.ADMIN)
  @Get('analytics')
  analytics() {
    return this.admin.analytics();
  }

  @Roles(UserRole.ADMIN)
  @Get('disputes')
  disputes(@Query('status') status?: DisputeStatus) {
    return this.admin.listDisputes(status);
  }

  @Roles(UserRole.ADMIN)
  @Put('disputes/:id/resolve')
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveDisputeDto) {
    return this.admin.resolveDispute(id, dto);
  }

  // Any authenticated user can raise a dispute on their booking.
  @Post('disputes')
  raise(@CurrentUser('userId') userId: string, @Body() dto: RaiseDisputeDto) {
    return this.admin.raiseDispute(userId, dto);
  }
}
