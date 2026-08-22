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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { VerificationService } from './verification.service';
import { SupportCasesService } from './support-cases.service';
import { OfficersService } from './officers.service';
import { IdentityService } from '../users/identity.service';
import {
  AllocateRequestDto,
  DecideVerificationDto,
  SubmitFindingsDto,
  VerificationQueryDto,
} from './dto/verification.dto';
import { CreateOfficerDto, ServiceAreaDto, SetOfficerStatusDto } from './dto/officer.dto';
import {
  AddEvidenceDto,
  AllocateCaseDto,
  CaseQueryDto,
  EscalateCaseDto,
  RaiseCaseDto,
  RecordFindingsDto,
  SettleCaseDto,
} from './dto/case.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';
import { UserRole } from '../../common/enums';

/**
 * The In-Person Verification portal, plus the admin allocation surface.
 *
 * Two audiences share these routes and see different slices: an officer only
 * ever sees work allocated to them, an administrator sees everything. That
 * split lives in the services rather than in duplicate controllers.
 */
@ApiTags('verification')
@ApiBearerAuth()
@Controller('verification')
export class VerificationController {
  constructor(
    private readonly verification: VerificationService,
    private readonly cases: SupportCasesService,
    private readonly officers: OfficersService,
    private readonly identity: IdentityService,
  ) {}

  // ------------------------------------------------------ identity documents

  @RequirePermissions(Permission.VERIFICATION_DECIDE)
  @ApiOperation({
    summary: 'Confirm a profile-holder’s identity document',
    description:
      'Recorded by the officer who saw the document and the person together. Nobody else can ' +
      'set it, which is the point of the visit.',
  })
  @Put('identity/:profileId/verify')
  verifyIdentity(
    @CurrentUser() actor: AuthUser,
    @Param('profileId', ParseUUIDPipe) profileId: string,
  ) {
    return this.identity.markVerified(actor, profileId);
  }

  // ---------------------------------------------------------- staff accounts

  @RequirePermissions(Permission.ADMIN_OFFICER_MANAGE)
  @ApiOperation({
    summary: 'Create an In-Person Verification account',
    description:
      'Admin only, and the only way one exists — there is no sign-up path for staff. ' +
      'Credentials are emailed and must be replaced at first sign-in.',
  })
  @Post('officers')
  createOfficer(@CurrentUser() actor: AuthUser, @Body() dto: CreateOfficerDto) {
    return this.officers.create(actor, dto);
  }

  @RequirePermissions(Permission.ADMIN_OFFICER_MANAGE)
  @Get('officers')
  listOfficers() {
    return this.officers.list();
  }

  @RequirePermissions(Permission.ADMIN_OFFICER_MANAGE)
  @ApiOperation({ summary: 'Suspend or restore an officer. Never deleted: their decisions stand.' })
  @Put('officers/:id/status')
  setOfficerStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetOfficerStatusDto,
  ) {
    return this.officers.setActive(actor, id, dto.isActive);
  }

  // ------------------------------------------------------- the applicant

  @ApiOperation({
    summary: 'Your own verification status',
    description: 'What an agent or vendor sees while waiting: the outcome and the reason.',
  })
  @Get('me')
  myStatus(@CurrentUser('userId') userId: string) {
    return this.verification.myStatus(userId);
  }

  // ------------------------------------------------- the queue and the work

  @RequirePermissions(Permission.VERIFICATION_PROCESS)
  @ApiOperation({
    summary: 'Verification queue',
    description: 'An officer sees only requests allocated to them; an admin sees all of them.',
  })
  @Get('requests')
  list(@CurrentUser() actor: AuthUser, @Query() q: VerificationQueryDto) {
    return this.verification.list(actor, q);
  }

  @RequirePermissions(Permission.VERIFICATION_PROCESS)
  @Get('requests/:id')
  findOne(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.verification.findOne(actor, id);
  }

  @RequirePermissions(Permission.VERIFICATION_PROCESS)
  @ApiOperation({ summary: 'Pick up an allocated request' })
  @Put('requests/:id/start')
  start(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.verification.start(actor, id);
  }

  // -------------------------------------------------------- service areas

  @RequirePermissions(Permission.ADMIN_OFFICER_MANAGE)
  @ApiOperation({
    summary: 'Where an officer will travel',
    description:
      'Allocation ranked on workload alone until this existed, which sends the lightest-loaded ' +
      'officer four hundred kilometres to look at a kitchen. Coverage decides the pool; workload ' +
      'decides within it.',
  })
  @Get('officers/:id/areas')
  listAreas(@Param('id', ParseUUIDPipe) id: string) {
    return this.verification.listAreas(id);
  }

  @RequirePermissions(Permission.ADMIN_OFFICER_MANAGE)
  @Post('officers/:id/areas')
  addArea(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ServiceAreaDto,
  ) {
    return this.verification.addArea(actor, id, dto);
  }

  @RequirePermissions(Permission.ADMIN_OFFICER_MANAGE)
  @Delete('areas/:id')
  removeArea(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.verification.removeArea(actor, id);
  }

  @RequirePermissions(Permission.VERIFICATION_PROCESS)
  @ApiOperation({
    summary: 'Write up what the visit found',
    description:
      'The step between attending and deciding. The officer reports; an administrator decides. ' +
      'Without it an approval carries no record that anybody went anywhere, which makes the ' +
      'whole verification a checkbox.',
  })
  @Put('requests/:id/findings')
  submitFindings(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitFindingsDto,
  ) {
    return this.verification.submitFindings(actor, id, dto);
  }

  @RequirePermissions(Permission.VERIFICATION_DECIDE)
  @ApiOperation({
    summary: 'Pick up submitted findings for review',
    description:
      'Stops two administrators reviewing the same report and reaching different conclusions ' +
      'ten seconds apart.',
  })
  @Put('requests/:id/review')
  beginReview(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.verification.beginReview(actor, id);
  }

  @RequirePermissions(Permission.VERIFICATION_DECIDE)
  @ApiOperation({
    summary: 'Record the verification decision',
    description:
      'An approval activates the applicant. Anything else blocks activation and requires a reason.',
  })
  @Put('requests/:id/decide')
  decide(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideVerificationDto,
  ) {
    return this.verification.decide(actor, id, dto);
  }

  @RequirePermissions(Permission.VERIFICATION_ALLOCATE)
  @ApiOperation({ summary: 'Allocate a request to a verification officer' })
  @Put('requests/:id/allocate')
  allocate(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AllocateRequestDto,
  ) {
    return this.verification.allocate(actor, id, dto);
  }

  @RequirePermissions(Permission.VERIFICATION_PROCESS)
  @ApiOperation({ summary: 'Counters for the verification dashboard' })
  @Get('metrics')
  async metrics(@CurrentUser() actor: AuthUser) {
    const scope = actor.role === UserRole.IN_PERSON ? actor.userId : undefined;
    return {
      requests: await this.verification.metrics(scope),
      cases: await this.cases.metrics(scope),
    };
  }

  @RequirePermissions(Permission.VERIFICATION_ALLOCATE)
  @ApiOperation({ summary: 'Open workload per officer, for allocation decisions' })
  @Get('workload')
  workload() {
    return this.verification.workload();
  }

  // ------------------------------------------------------------- the cases

  @RequirePermissions(Permission.CASE_RAISE)
  @ApiOperation({
    summary: 'Raise an issue',
    description:
      'Raising one against a booking freezes any escrow held on it until a settlement is recorded.',
  })
  @Post('cases')
  raise(@CurrentUser() actor: AuthUser, @Body() dto: RaiseCaseDto) {
    return this.cases.raise(actor, dto);
  }

  @RequirePermissions(Permission.CASE_RAISE)
  @ApiOperation({ summary: 'Cases you raised; officers see their queue, admins see all' })
  @Get('cases')
  listCases(@CurrentUser() actor: AuthUser, @Query() q: CaseQueryDto) {
    return this.cases.list(actor, q);
  }

  @RequirePermissions(Permission.CASE_RAISE)
  @Get('cases/:id')
  findCase(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.cases.findOne(actor, id);
  }

  @RequirePermissions(Permission.CASE_ALLOCATE)
  @Put('cases/:id/allocate')
  allocateCase(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AllocateCaseDto,
  ) {
    return this.cases.allocate(actor, id, dto);
  }

  @RequirePermissions(Permission.CASE_INVESTIGATE)
  @ApiOperation({ summary: 'Record what the investigation found' })
  @Put('cases/:id/findings')
  findings(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordFindingsDto,
  ) {
    return this.cases.recordFindings(actor, id, dto);
  }

  @RequirePermissions(Permission.CASE_ALLOCATE)
  @ApiOperation({
    summary: 'Escalate a case to a physical visit',
    description:
      'For a dispute nobody can settle from a desk. Routes it to a field officer rather than ' +
      'leaving it circling in a queue that cannot resolve it.',
  })
  @Put('cases/:id/escalate')
  escalateCase(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EscalateCaseDto,
  ) {
    return this.cases.escalate(actor, id, dto.reason);
  }

  @RequirePermissions(Permission.CASE_INVESTIGATE)
  @ApiOperation({
    summary: 'Park the case on whoever owes an answer',
    description: 'Distinct from in-progress: the clock is on one of the parties, not the officer.',
  })
  @Put('cases/:id/await-information')
  awaitInformation(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EscalateCaseDto,
  ) {
    return this.cases.awaitInformation(actor, id, dto.reason);
  }

  @RequirePermissions(Permission.CASE_RAISE)
  @ApiOperation({ summary: 'Add evidence to an open case' })
  @Put('cases/:id/evidence')
  addEvidence(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddEvidenceDto,
  ) {
    return this.cases.addEvidence(actor, id, dto.evidence);
  }

  @RequirePermissions(Permission.CASE_SETTLE)
  @ApiOperation({
    summary: 'Record the settlement decision',
    description: 'Release, refund, partial or no action. This is what unfreezes disputed escrow.',
  })
  @Put('cases/:id/settle')
  settle(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SettleCaseDto,
  ) {
    return this.cases.settle(actor, id, dto);
  }

  @RequirePermissions(Permission.CASE_INVESTIGATE)
  @Put('cases/:id/close')
  close(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.cases.close(actor, id);
  }
}
