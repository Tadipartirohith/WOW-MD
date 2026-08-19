import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService, AuthResult } from './auth.service';
import { SessionsService } from './sessions.service';
import { InvitationsService } from '../invitations/invitations.service';
import {
  AcceptInvitationDto,
  ChangePasswordDto,
  ConfirmMfaDto,
  DisableMfaDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  RequestPasswordResetDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission, permissionsFor } from '../../common/authz/permissions';
import { ACCOUNT_TYPE_ROLE, AccountType, INDIVIDUAL_ROLES } from '../../common/enums';
import { AppConfigService } from '../../config/app-config.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly invitations: InvitationsService,
    private readonly cfg: AppConfigService,
  ) {}

  private ctx(req: Request) {
    return { userAgent: req.headers['user-agent'] ?? null, ip: req.ip ?? null };
  }

  /**
   * Puts the refresh token in an httpOnly cookie and strips it from the JSON.
   *
   * Page script can never read an httpOnly cookie, so an XSS bug can no longer
   * walk off with a 30-day credential. The short-lived access token stays in
   * the body and lives only in memory on the client.
   */
  private respond(res: Response, result: AuthResult) {
    const a = this.cfg.auth;
    res.cookie(a.refreshCookieName, result.refreshToken, {
      httpOnly: true,
      secure: a.cookieSecure,
      sameSite: a.cookieSameSite,
      domain: a.cookieDomain,
      // Scoped to the refresh and logout routes, so the cookie is not attached
      // to every ordinary API call.
      path: `/${this.cfg.runtime.apiPrefix}/auth`,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    const { refreshToken, ...body } = result;
    void refreshToken;
    return body;
  }

  private clearCookie(res: Response) {
    res.clearCookie(this.cfg.auth.refreshCookieName, {
      path: `/${this.cfg.runtime.apiPrefix}/auth`,
      domain: this.cfg.auth.cookieDomain,
    });
  }

  /** Cookie first; body only for clients that cannot hold cookies. */
  private readRefreshToken(req: Request, dto?: RefreshDto): string | undefined {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    return cookies?.[this.cfg.auth.refreshCookieName] ?? dto?.refreshToken;
  }

  // ------------------------------------------------------------ sign-up flow

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
          description:
            'Build profiles for clients, invite them to claim their account, and book services for them. Reviewed before activation.',
          requiresRole: false,
          role: ACCOUNT_TYPE_ROLE[AccountType.AGENT],
          requiresApproval: true,
        },
        {
          type: AccountType.VENDOR,
          label: 'Vendor',
          description: 'Sell wedding services: venue, catering, photography and more.',
          requiresRole: false,
          role: ACCOUNT_TYPE_ROLE[AccountType.VENDOR],
          requiresApproval: true,
        },
        {
          type: AccountType.PLANNER,
          label: 'Wedding planner',
          description: 'Offer planning packages and co-manage the weddings you are engaged on.',
          requiresRole: false,
          role: ACCOUNT_TYPE_ROLE[AccountType.PLANNER],
          requiresApproval: true,
        },
      ],
    };
  }

  /**
   * Self-service registration. This path is always open — anyone can create
   * their own account and sign in immediately, whether or not an agent is
   * involved anywhere.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.register(dto, this.ctx(req)));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(200)
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.login(dto, this.ctx(req)));
  }

  // ---------------------------------------------------------- invitation flow

  /**
   * Public preview of an invitation, so the landing page can show who invited
   * whom before asking for a password. Deliberately narrow: holding the link
   * does not yet prove you are the right person.
   */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Get('invitations/:token')
  previewInvitation(@Param('token') token: string) {
    return this.invitations.preview(token);
  }

  /**
   * Accepts an invitation: creates the account, hands the profile to its
   * subject and signs them in. The email address is treated as verified because
   * following the link proved control of it.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('invitations/accept')
  async acceptInvitation(
    @Body() dto: AcceptInvitationDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.invitations.accept(dto.token, dto.password);
    return this.respond(res, await this.auth.issueTokens(user, this.ctx(req)));
  }

  // ---------------------------------------------------------------- sessions

  /**
   * Public by design: the refresh token is the credential being presented, and
   * requiring a live access token here would defeat the purpose of refresh.
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(200)
  @Post('refresh')
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = this.readRefreshToken(req, dto);
    if (!token) {
      this.clearCookie(res);
      throw new UnauthorizedException('No refresh token supplied');
    }
    return this.respond(res, await this.auth.refresh(token, this.ctx(req)));
  }

  @Public()
  @HttpCode(200)
  @Post('logout')
  async logout(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = this.readRefreshToken(req, dto);
    this.clearCookie(res);
    return this.auth.logout(token);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.SESSION_MANAGE_OWN)
  @HttpCode(200)
  @Post('logout-all')
  async logoutAll(@CurrentUser('userId') userId: string, @Res({ passthrough: true }) res: Response) {
    this.clearCookie(res);
    return this.auth.logoutEverywhere(userId);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.SESSION_MANAGE_OWN)
  @ApiOperation({ summary: 'Devices currently signed in to this account' })
  @Get('sessions')
  listSessions(@CurrentUser('userId') userId: string, @Req() req: Request) {
    return this.sessions.listActive(userId, this.readRefreshToken(req));
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.SESSION_MANAGE_OWN)
  @Delete('sessions/:id')
  revokeSession(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.revokeOwn(userId, id);
  }

  // ------------------------------------------------------ email + credentials

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(200)
  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 300000 } })
  @HttpCode(200)
  @Post('verify-email/resend')
  resendVerification(@CurrentUser('userId') userId: string) {
    return this.auth.resendVerification(userId);
  }

  /** Always 200, whether or not the address exists (no enumeration oracle). */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 300000 } })
  @HttpCode(200)
  @Post('password/forgot')
  requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    return this.auth.requestPasswordReset(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(200)
  @Post('password/reset')
  async resetPassword(@Body() dto: ResetPasswordDto, @Res({ passthrough: true }) res: Response) {
    this.clearCookie(res);
    return this.auth.resetPassword(dto);
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post('password/change')
  async changePassword(
    @CurrentUser('userId') userId: string,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.clearCookie(res);
    return this.auth.changePassword(userId, dto);
  }

  // --------------------------------------------------------------------- MFA

  @ApiBearerAuth()
  @RequirePermissions(Permission.MFA_MANAGE_OWN)
  @ApiOperation({ summary: 'Begin two-factor setup; returns the otpauth:// URI' })
  @Post('mfa/setup')
  beginMfa(@CurrentUser('userId') userId: string) {
    return this.auth.beginMfaSetup(userId);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.MFA_MANAGE_OWN)
  @HttpCode(200)
  @Post('mfa/confirm')
  confirmMfa(@CurrentUser('userId') userId: string, @Body() dto: ConfirmMfaDto) {
    return this.auth.confirmMfa(userId, dto.code);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.MFA_MANAGE_OWN)
  @HttpCode(200)
  @Post('mfa/disable')
  disableMfa(@CurrentUser('userId') userId: string, @Body() dto: DisableMfaDto) {
    return this.auth.disableMfa(userId, dto.password, dto.code);
  }

  // ------------------------------------------------------------------- whoami

  /** What the signed-in caller is allowed to do; used to shape the client nav. */
  @ApiBearerAuth()
  @Get('me/permissions')
  myPermissions(@CurrentUser() user: AuthUser) {
    return { role: user.role, permissions: permissionsFor(user.role) };
  }
}
