import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto, RefreshDto } from './dto/auth.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { permissionsFor } from '../../common/authz/permissions';
import { ACCOUNT_TYPE_ROLE, AccountType, INDIVIDUAL_ROLES } from '../../common/enums';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Drives the account-type picker on the sign-up screen. */
  @Public()
  @Get('account-types')
  @ApiOperation({ summary: 'Account types a visitor may self-register as' })
  accountTypes() {
    return {
      accountTypes: [
        {
          type: AccountType.INDIVIDUAL,
          label: 'Individual',
          description: 'Looking for a match, or a family member searching on their behalf.',
          requiresRole: true,
          roles: INDIVIDUAL_ROLES,
        },
        {
          type: AccountType.AGENT,
          label: 'Marriage agent',
          description: 'Onboard and represent clients, and book services for them.',
          requiresRole: false,
          role: ACCOUNT_TYPE_ROLE[AccountType.AGENT],
        },
        {
          type: AccountType.VENDOR,
          label: 'Vendor',
          description: 'Sell wedding services: venue, catering, photography and more.',
          requiresRole: false,
          role: ACCOUNT_TYPE_ROLE[AccountType.VENDOR],
        },
        {
          type: AccountType.PLANNER,
          label: 'Wedding planner',
          description: 'Offer planning packages and co-manage the weddings you are engaged on.',
          requiresRole: false,
          role: ACCOUNT_TYPE_ROLE[AccountType.PLANNER],
        },
      ],
    };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  /**
   * Public by design: the refresh token is the credential being presented, and
   * requiring a live access token here would defeat the purpose of refresh.
   */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post('logout')
  logout(@CurrentUser('userId') userId: string) {
    return this.auth.logout(userId);
  }

  /** What the signed-in caller is allowed to do; used to shape the client nav. */
  @ApiBearerAuth()
  @Get('me/permissions')
  myPermissions(@CurrentUser() user: AuthUser) {
    return { role: user.role, permissions: permissionsFor(user.role) };
  }
}
