import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AgentsService } from './agents.service';
import { ClientSearchDto, UpdateClientStatusDto } from './dto/agent.dto';
import { CreateClientDto } from '../auth/dto/auth.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';

@ApiTags('agents')
@ApiBearerAuth()
@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @RequirePermissions(Permission.CLIENT_CREATE)
  @ApiOperation({
    summary: 'Onboard a client',
    description:
      'Creates an individual account stamped with the calling agent id. The client can sign in ' +
      'themselves; the agent may also act on their behalf for matchmaking and bookings.',
  })
  @Post('clients')
  createClient(@CurrentUser('userId') agentId: string, @Body() dto: CreateClientDto) {
    return this.agents.createClient(agentId, dto);
  }

  @RequirePermissions(Permission.CLIENT_READ)
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
