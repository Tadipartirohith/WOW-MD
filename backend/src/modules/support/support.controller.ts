import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { AppConfigService } from '../../config/app-config.service';

/**
 * How to reach a human.
 *
 * The platform already has support *cases* — a queue an administrator works —
 * but they can only be raised against a booking somebody already has. Whoever
 * cannot sign in, or whose payment failed before a booking existed, had
 * nowhere to go at all. A platform holding money in escrow needs an answer to
 * "who do I call", and it needs it on the sign-in page as much as inside the
 * app.
 *
 * Public on purpose: being locked out is one of the main reasons to want it.
 */
@ApiTags('support')
@Controller('support')
export class SupportController {
  constructor(private readonly cfg: AppConfigService) {}

  @Public()
  @ApiOperation({ summary: 'Where to reach support. Unconfigured channels are omitted.' })
  @Get('contact')
  contact() {
    const s = this.cfg.support;

    /*
     * A blank channel is left out rather than returned empty.
     *
     * These are shown to people and acted on, so publishing an address nobody
     * reads is worse than publishing nothing — somebody writes to it, hears
     * back from no one, and concludes the business has gone under. The client
     * renders what it is given, so omission is what turns a channel off.
     */
    const channel = (value: string) => (value && value.trim() ? value.trim() : undefined);

    return {
      email: channel(s.email),
      phone: channel(s.phone),
      whatsapp: channel(s.whatsapp),
      url: channel(s.url),
      hours: channel(s.hours),
      responseTime: channel(s.responseTime),
      /** Nothing is set: the client says so plainly instead of showing a blank card. */
      configured: Boolean(channel(s.email) || channel(s.phone) || channel(s.whatsapp)),
    };
  }
}
