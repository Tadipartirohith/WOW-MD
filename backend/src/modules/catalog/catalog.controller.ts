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
import { CatalogService } from './catalog.service';
import {
  CreateAttributeDto,
  CreateCategoryDto,
  CreateDefinitionDto,
  UpdateAttributeDto,
  UpdateCategoryDto,
  UpdateDefinitionDto,
} from './dto/catalog.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';
import {
  AttributeScope,
  AvailabilityModel,
  PricingModel,
  ServiceAttributeType,
} from '../../common/enums';

/**
 * Reading the catalog.
 *
 * Open to every signed-in account, because a buyer choosing a service and a
 * vendor choosing what to list are reading the same rows. Only writing is
 * privileged, and that lives on the controller below.
 */
@ApiTags('catalog')
@ApiBearerAuth()
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @ApiOperation({
    summary: 'The vocabulary the catalog is configured in',
    description:
      'Attribute types, pricing models and availability models, so an admin UI can build its ' +
      'pickers from the server rather than from a second hand-written copy.',
  })
  @Get('vocabulary')
  vocabulary() {
    return {
      attributeTypes: Object.values(ServiceAttributeType),
      attributeScopes: Object.values(AttributeScope),
      pricingModels: Object.values(PricingModel),
      availabilityModels: Object.values(AvailabilityModel),
    };
  }

  @Get('categories')
  categories(@Query('includeInactive') includeInactive?: string) {
    return this.catalog.listCategories(includeInactive === 'true');
  }

  @Get('categories/:id/services')
  definitions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.catalog.listDefinitions(id, includeInactive === 'true');
  }

  @Get('services')
  allDefinitions(@Query('includeInactive') includeInactive?: string) {
    return this.catalog.listDefinitions(undefined, includeInactive === 'true');
  }

  @ApiOperation({
    summary: 'A service definition and the two forms it generates',
    description:
      'The vendor form and the buyer form come from the same rows the validator uses, so a ' +
      'form the client renders can never disagree with a payload the server accepts.',
  })
  @Get('services/:id')
  describe(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.describeDefinition(id);
  }

  @Get('services/:id/attributes')
  attributes(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.attributesFor(id);
  }
}

/**
 * Configuring the catalog. Administrators only.
 *
 * This is the controller that replaces shipping a module per vendor type: a
 * new trade is a category, a definition and a handful of attributes, written
 * here.
 */
@ApiTags('catalog')
@ApiBearerAuth()
@RequirePermissions(Permission.CATALOG_MANAGE)
@Controller('admin/catalog')
export class CatalogAdminController {
  constructor(private readonly catalog: CatalogService) {}

  @Post('categories')
  createCategory(@CurrentUser() actor: AuthUser, @Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(actor, dto);
  }

  @ApiOperation({
    summary: 'Update or retire a category',
    description:
      'Categories are never deleted. Retiring one (active: false) keeps every booking already ' +
      'made under it readable while stopping it appearing on new listings.',
  })
  @Put('categories/:id')
  updateCategory(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.catalog.updateCategory(actor, id, dto);
  }

  @Post('categories/:id/services')
  createDefinition(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateDefinitionDto,
  ) {
    return this.catalog.createDefinition(actor, id, dto);
  }

  @ApiOperation({
    summary: 'Update or retire a service definition',
    description:
      'Narrowing allowedPricingModels is refused while vendors are still selling on one of the ' +
      'models being withdrawn — otherwise their listing becomes uneditable for reasons nobody ' +
      'can explain from the error.',
  })
  @Put('services/:id')
  updateDefinition(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDefinitionDto,
  ) {
    return this.catalog.updateDefinition(actor, id, dto);
  }

  @Post('services/:id/attributes')
  addAttribute(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAttributeDto,
  ) {
    return this.catalog.addAttribute(actor, id, dto);
  }

  @Put('attributes/:id')
  updateAttribute(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAttributeDto,
  ) {
    return this.catalog.updateAttribute(actor, id, dto);
  }

  @ApiOperation({
    summary: 'Remove an attribute from a form',
    description:
      'Answers already stored under its key are left alone — the validator drops unknown keys ' +
      'on the next write, so the data ages out instead of turning existing listings into 400s.',
  })
  @Delete('attributes/:id')
  removeAttribute(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.removeAttribute(actor, id);
  }
}
