import { Module } from '@nestjs/common';
import { SupportController } from './support.controller';

/**
 * Contact details, and nothing else.
 *
 * Support *cases* live in the verification module, with the officers and the
 * administrators who work them. This is the other half — how somebody starts a
 * conversation when they have no case, and often no session either. It reads
 * configuration and holds no state, which is why it has no service.
 */
@Module({
  controllers: [SupportController],
})
export class SupportModule {}
