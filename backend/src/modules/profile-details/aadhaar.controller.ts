import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AadhaarService } from './aadhaar.service';
import { SendAadhaarOtpDto, VerifyAadhaarOtpDto } from './dto/aadhaar.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';

/**
 * Aadhaar verification by OTP.
 *
 * Rate-limited hard: an OTP endpoint is an SMS bill and a brute-force surface
 * at the same time, and the per-session attempt cap in the service is the
 * second half of the same defence.
 */
@ApiTags('identity')
@ApiBearerAuth()
@RequirePermissions(Permission.PROFILE_MANAGE_OWN)
@Controller('profiles/:id/identity/aadhaar')
export class AadhaarController {
  constructor(private readonly aadhaar: AadhaarService) {}

  @ApiOperation({
    summary: 'Send an OTP to the number registered against the Aadhaar',
    description: 'The number is validated, hashed and discarded. Only the last four digits survive.',
  })
  @Throttle({ default: { limit: 5, ttl: 300000 } })
  @HttpCode(200)
  @Post('send-otp')
  send(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendAadhaarOtpDto,
  ) {
    return this.aadhaar.sendOtp(actor, id, dto);
  }

  @ApiOperation({ summary: 'Confirm the code' })
  @Throttle({ default: { limit: 10, ttl: 300000 } })
  @HttpCode(200)
  @Post('verify-otp')
  verify(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyAadhaarOtpDto,
  ) {
    return this.aadhaar.verifyOtp(actor, id, dto);
  }

  @ApiOperation({ summary: 'Where verification stands' })
  @Get()
  status(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.aadhaar.status(actor, id);
  }
}
