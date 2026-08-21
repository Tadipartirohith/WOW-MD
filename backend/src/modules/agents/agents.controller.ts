import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AgentsService } from './agents.service';
import { AgencyService } from './agency.service';
import { ManagedProfilesService } from './managed-profiles.service';
import { AgentBillingService } from './agent-billing.service';
import { EndEngagementDto } from './dto/lifecycle.dto';
import { InvitationsService } from '../invitations/invitations.service';
import { ClientSearchDto, UpdateClientStatusDto } from './dto/agent.dto';
import { UpsertAgencyDto } from './dto/agency.dto';
import {
  AddProfilePhotoDto,
  CreateManagedProfileDto,
  ManagedProfileSearchDto,
  UpdateManagedProfileDto,
} from './dto/managed-profile.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';

@ApiTags('agents')
@ApiBearerAuth()
@Controller('agents')
export class AgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly agency: AgencyService,
    private readonly managed: ManagedProfilesService,
    private readonly agentBilling: AgentBillingService,
    private readonly invitations: InvitationsService,
  ) {}

  // ------------------------------------------------------------- the agency

  @RequirePermissions(Permission.AGENCY_MANAGE)
  @ApiOperation({
    summary: 'Register or update your agency',
    description:
      'An agency must be approved by an administrator before it can build client profiles or ' +
      'send invitations. Signing in and browsing work immediately.',
  })
  @Put('agency')
  upsertAgency(@CurrentUser('userId') userId: string, @Body() dto: UpsertAgencyDto) {
    return this.agency.upsertOwn(userId, dto);
  }

  @RequirePermissions(Permission.AGENCY_MANAGE)
  @Get('agency')
  getAgency(@CurrentUser('userId') userId: string) {
    return this.agency.getOwn(userId);
  }

  /** Approval banner for the client; null when nothing is registered yet. */
  @RequirePermissions(Permission.AGENCY_MANAGE)
  @Get('agency/status')
  async agencyStatus(@CurrentUser('userId') userId: string) {
    const agency = await this.agency.findOwn(userId);
    return {
      registered: Boolean(agency),
      approved: agency?.isApproved ?? false,
      rejectionReason: agency?.rejectionReason ?? null,
      agencyName: agency?.agencyName ?? null,
    };
  }

  // ----------------------------------------------- profiles without accounts

  @RequirePermissions(Permission.MANAGED_PROFILE_MANAGE)
  @ApiOperation({
    summary: 'Build a profile for someone with no account',
    description:
      'Creates a complete, matchable profile — photos, preferences, contact details — for a ' +
      'person who has not signed up. Contact email and mobile are required because they are the ' +
      'only route to an invitation. Pass inviteNow to email the invitation immediately.',
  })
  @Post('profiles')
  createProfile(@CurrentUser() actor: AuthUser, @Body() dto: CreateManagedProfileDto) {
    return this.managed.create(actor, dto);
  }

  @RequirePermissions(Permission.MANAGED_PROFILE_MANAGE)
  @Get('profiles')
  listProfiles(@CurrentUser() actor: AuthUser, @Query() q: ManagedProfileSearchDto) {
    return this.managed.list(actor, q);
  }

  /** Every profile the caller may act under: their own plus those they steward. */
  @RequirePermissions(Permission.ACT_ON_BEHALF)
  @Get('profiles/actable')
  actable(@CurrentUser() actor: AuthUser) {
    return this.managed.actableProfiles(actor);
  }

  @RequirePermissions(Permission.MANAGED_PROFILE_MANAGE)
  @Get('profiles/:id')
  getProfile(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.managed.findOne(actor, id);
  }

  @RequirePermissions(Permission.MANAGED_PROFILE_MANAGE)
  @Put('profiles/:id')
  updateProfile(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateManagedProfileDto,
  ) {
    return this.managed.update(actor, id, dto);
  }

  @RequirePermissions(Permission.MANAGED_PROFILE_MANAGE)
  @Post('profiles/:id/photos')
  addPhoto(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddProfilePhotoDto,
  ) {
    return this.managed.addPhoto(actor, id, dto);
  }

  @RequirePermissions(Permission.MANAGED_PROFILE_MANAGE)
  @Delete('profiles/:id/photos')
  removePhoto(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddProfilePhotoDto,
  ) {
    return this.managed.removePhoto(actor, id, dto.url);
  }

  @RequirePermissions(Permission.MANAGED_PROFILE_MANAGE)
  @ApiOperation({
    summary: 'Pause a profile',
    description: 'Reversible. It stops matching and circulating; nothing is deleted or refunded.',
  })
  @Put('profiles/:id/deactivate')
  deactivateProfile(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EndEngagementDto,
  ) {
    return this.managed.deactivate(actor, id, dto.reason);
  }

  @RequirePermissions(Permission.MANAGED_PROFILE_MANAGE)
  @Put('profiles/:id/reactivate')
  reactivateProfile(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.managed.reactivate(actor, id);
  }

  @RequirePermissions(Permission.MANAGED_PROFILE_MANAGE)
  @ApiOperation({
    summary: 'Close the engagement',
    description:
      'A soft delete: the profile stops matching for good, the record survives for consent and ' +
      'audit, and any fee still in escrow is refunded.',
  })
  @Put('profiles/:id/archive')
  archiveProfile(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EndEngagementDto,
  ) {
    return this.managed.archive(actor, id, dto.reason);
  }

  // ---------------------------------------------------------------- billing

  @RequirePermissions(Permission.CLIENT_READ)
  @ApiOperation({ summary: 'The agency ledger: what is owed, held and earned' })
  @Get('billing')
  billing(@CurrentUser() actor: AuthUser) {
    return this.agentBilling.listForAgent(actor);
  }

  @RequirePermissions(Permission.MANAGED_PROFILE_MANAGE)
  @ApiOperation({ summary: 'Charges raised against one client profile' })
  @Get('profiles/:id/charges')
  profileCharges(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.agentBilling.listForProfile(actor, id);
  }

  @RequirePermissions(Permission.AGENCY_FEE_PAY)
  @ApiOperation({
    summary: 'Pay an agency charge',
    description:
      'The money is held in escrow and reaches the agency only once the match is fixed.',
  })
  @Put('charges/:chargeId/pay')
  payCharge(
    @CurrentUser() actor: AuthUser,
    @Param('chargeId', ParseUUIDPipe) chargeId: string,
  ) {
    return this.agentBilling.pay(actor, chargeId);
  }

  @RequirePermissions(Permission.MANAGED_PROFILE_MANAGE)
  @Delete('profiles/:id')
  removeProfile(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.managed.remove(actor, id);
  }

  // ------------------------------------------------------------- invitations

  @RequirePermissions(Permission.MANAGED_PROFILE_INVITE)
  @ApiOperation({
    summary: 'Email an invitation to claim a managed profile',
    description:
      'The subject sets their own password when they accept, so the steward never knows their ' +
      'credentials. Re-sending supersedes any earlier link.',
  })
  @Post('profiles/:id/invite')
  invite(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.invitations.invite(actor, id);
  }

  @RequirePermissions(Permission.MANAGED_PROFILE_INVITE)
  @Get('profiles/:id/invitations')
  listInvitations(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.invitations.listForProfile(actor, id);
  }

  @RequirePermissions(Permission.MANAGED_PROFILE_INVITE)
  @Delete('invitations/:id')
  revokeInvitation(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.invitations.revoke(actor, id);
  }

  // ------------------------------------------------------- the book of business

  @RequirePermissions(Permission.CLIENT_READ)
  @ApiOperation({ summary: 'Client accounts that resulted from your invitations' })
  @Get('clients')
  listClients(@CurrentUser('userId') agentId: string, @Query() q: ClientSearchDto) {
    return this.agents.listClients(agentId, q);
  }

  @RequirePermissions(Permission.CLIENT_READ)
  @Get('clients/:id')
  getClient(@CurrentUser('userId') agentId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.agents.getClient(agentId, id);
  }

  @RequirePermissions(Permission.CLIENT_CREATE)
  @Put('clients/:id/status')
  setStatus(
    @CurrentUser('userId') agentId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientStatusDto,
  ) {
    return this.agents.setClientStatus(agentId, id, dto.isActive);
  }
}
