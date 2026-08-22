import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceDefinition } from './entities/service-definition.entity';
import { ServiceAttribute } from './entities/service-attribute.entity';
import { VendorService } from './entities/vendor-service.entity';
import {
  CreateAttributeDto,
  CreateCategoryDto,
  CreateDefinitionDto,
  UpdateAttributeDto,
  UpdateCategoryDto,
  UpdateDefinitionDto,
} from './dto/catalog.dto';
import { describeForm } from './attribute-validation';
import { AttributeScope } from '../../common/enums';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

/**
 * The administrator's half of the catalog: categories, service definitions and
 * the attributes that make up their forms.
 *
 * Nothing here is deleted once anything references it. A category with
 * listings, a definition with vendor services, an attribute with stored
 * answers — retiring means `active = false`, which stops it appearing on new
 * work while leaving every booking already made under it readable. Hard
 * deletion would leave a confirmed wedding booking pointing at nothing.
 */
@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(ServiceCategory)
    private readonly categories: Repository<ServiceCategory>,
    @InjectRepository(ServiceDefinition)
    private readonly definitions: Repository<ServiceDefinition>,
    @InjectRepository(ServiceAttribute)
    private readonly attributes: Repository<ServiceAttribute>,
    @InjectRepository(VendorService)
    private readonly vendorServices: Repository<VendorService>,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------- categories

  async listCategories(includeInactive = false): Promise<ServiceCategory[]> {
    return this.categories.find({
      where: includeInactive ? {} : { active: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async createCategory(actor: AuthUser, dto: CreateCategoryDto): Promise<ServiceCategory> {
    const clash = await this.categories.findOne({ where: { slug: dto.slug } });
    if (clash) throw new BadRequestException(`There is already a category called "${dto.slug}"`);

    const saved = await this.categories.save(
      this.categories.create({
        slug: dto.slug,
        name: dto.name,
        description: dto.description ?? null,
        icon: dto.icon ?? null,
        sortOrder: dto.sortOrder ?? 0,
        active: true,
      }),
    );

    await this.audit.record({
      action: AuditAction.CATALOG_CATEGORY_CHANGED,
      actor,
      resourceType: 'service_category',
      resourceId: saved.id,
      metadata: { slug: saved.slug, change: 'created' },
    });
    return saved;
  }

  async updateCategory(
    actor: AuthUser,
    id: string,
    dto: UpdateCategoryDto,
  ): Promise<ServiceCategory> {
    const category = await this.categories.findOne({ where: { id } });
    if (!category) throw new NotFoundException('Category not found');

    Object.assign(category, {
      name: dto.name ?? category.name,
      description: dto.description ?? category.description,
      icon: dto.icon ?? category.icon,
      active: dto.active ?? category.active,
      sortOrder: dto.sortOrder ?? category.sortOrder,
    });
    const saved = await this.categories.save(category);

    await this.audit.record({
      action: AuditAction.CATALOG_CATEGORY_CHANGED,
      actor,
      resourceType: 'service_category',
      resourceId: saved.id,
      metadata: { slug: saved.slug, change: 'updated', active: saved.active },
    });
    return saved;
  }

  // ------------------------------------------------------------ definitions

  async listDefinitions(categoryId?: string, includeInactive = false): Promise<ServiceDefinition[]> {
    const where: Record<string, unknown> = {};
    if (categoryId) where.categoryId = categoryId;
    if (!includeInactive) where.active = true;
    return this.definitions.find({ where, order: { sortOrder: 'ASC', name: 'ASC' } });
  }

  async getDefinition(id: string): Promise<ServiceDefinition> {
    const definition = await this.definitions.findOne({ where: { id } });
    if (!definition) throw new NotFoundException('Service not found in the catalog');
    return definition;
  }

  /**
   * A definition plus the two forms it generates.
   *
   * The vendor form and the buyer form come from the same rows the validator
   * uses, so a form the client renders and a payload the server accepts can
   * never disagree.
   */
  async describeDefinition(id: string) {
    const definition = await this.getDefinition(id);
    const [category, attributes] = await Promise.all([
      this.categories.findOne({ where: { id: definition.categoryId } }),
      this.attributesFor(id),
    ]);

    return {
      definition,
      category,
      serviceForm: describeForm(attributes, AttributeScope.SERVICE),
      bookingForm: describeForm(attributes, AttributeScope.BOOKING),
    };
  }

  async createDefinition(
    actor: AuthUser,
    categoryId: string,
    dto: CreateDefinitionDto,
  ): Promise<ServiceDefinition> {
    const category = await this.categories.findOne({ where: { id: categoryId } });
    if (!category) throw new NotFoundException('Category not found');

    const clash = await this.definitions.findOne({ where: { categoryId, slug: dto.slug } });
    if (clash) {
      throw new BadRequestException(`"${category.name}" already has a service called "${dto.slug}"`);
    }

    const saved = await this.definitions.save(
      this.definitions.create({
        categoryId,
        slug: dto.slug,
        name: dto.name,
        description: dto.description ?? null,
        allowedPricingModels: dto.allowedPricingModels,
        availabilityModel: dto.availabilityModel,
        packagesAllowed: dto.packagesAllowed ?? true,
        defaultCapacity: dto.defaultCapacity ?? 1,
        sortOrder: dto.sortOrder ?? 0,
        active: true,
      }),
    );

    await this.audit.record({
      action: AuditAction.CATALOG_DEFINITION_CHANGED,
      actor,
      resourceType: 'service_definition',
      resourceId: saved.id,
      metadata: { slug: saved.slug, categoryId, change: 'created' },
    });
    return saved;
  }

  async updateDefinition(
    actor: AuthUser,
    id: string,
    dto: UpdateDefinitionDto,
  ): Promise<ServiceDefinition> {
    const definition = await this.getDefinition(id);

    // Narrowing the allowed pricing models would strand offerings already
    // published under one that is being withdrawn. Say so rather than leaving
    // a listing that cannot be edited without a 400 nobody can explain.
    if (dto.allowedPricingModels) {
      const removed = definition.allowedPricingModels.filter(
        (m) => !dto.allowedPricingModels?.includes(m),
      );
      if (removed.length > 0) {
        const inUse = await this.pricingModelsInUse(id);
        const stranded = removed.filter((m) => inUse.includes(m));
        if (stranded.length > 0) {
          throw new BadRequestException(
            `Vendors are already selling on ${stranded.join(', ')}. Retire those offerings first.`,
          );
        }
      }
    }

    Object.assign(definition, {
      name: dto.name ?? definition.name,
      description: dto.description ?? definition.description,
      allowedPricingModels: dto.allowedPricingModels ?? definition.allowedPricingModels,
      availabilityModel: dto.availabilityModel ?? definition.availabilityModel,
      packagesAllowed: dto.packagesAllowed ?? definition.packagesAllowed,
      defaultCapacity: dto.defaultCapacity ?? definition.defaultCapacity,
      active: dto.active ?? definition.active,
      sortOrder: dto.sortOrder ?? definition.sortOrder,
    });
    const saved = await this.definitions.save(definition);

    await this.audit.record({
      action: AuditAction.CATALOG_DEFINITION_CHANGED,
      actor,
      resourceType: 'service_definition',
      resourceId: saved.id,
      metadata: { slug: saved.slug, change: 'updated', active: saved.active },
    });
    return saved;
  }

  /** Which pricing models vendors are currently selling this definition on. */
  private async pricingModelsInUse(definitionId: string): Promise<string[]> {
    const rows = await this.vendorServices
      .createQueryBuilder('vs')
      .innerJoin('service_offerings', 'o', 'o."vendorServiceId" = vs.id')
      .where('vs."definitionId" = :definitionId', { definitionId })
      .andWhere('o.active = true')
      .select('DISTINCT o."pricingModel"', 'pricingModel')
      .getRawMany<{ pricingModel: string }>();
    return rows.map((r) => r.pricingModel);
  }

  // ------------------------------------------------------------- attributes

  async attributesFor(definitionId: string): Promise<ServiceAttribute[]> {
    return this.attributes.find({
      where: { definitionId },
      order: { scope: 'ASC', sortOrder: 'ASC' },
    });
  }

  async attributesForMany(definitionIds: string[]): Promise<Map<string, ServiceAttribute[]>> {
    if (definitionIds.length === 0) return new Map();
    const rows = await this.attributes.find({
      where: { definitionId: In(definitionIds) },
      order: { sortOrder: 'ASC' },
    });
    const grouped = new Map<string, ServiceAttribute[]>();
    for (const row of rows) {
      const list = grouped.get(row.definitionId) ?? [];
      list.push(row);
      grouped.set(row.definitionId, list);
    }
    return grouped;
  }

  async addAttribute(
    actor: AuthUser,
    definitionId: string,
    dto: CreateAttributeDto,
  ): Promise<ServiceAttribute> {
    await this.getDefinition(definitionId);

    const clash = await this.attributes.findOne({
      where: { definitionId, scope: dto.scope, key: dto.key },
    });
    if (clash) {
      throw new BadRequestException(`This service already asks "${dto.key}" on the ${dto.scope} form`);
    }

    this.assertConstraintsMakeSense(dto);

    const saved = await this.attributes.save(
      this.attributes.create({
        definitionId,
        scope: dto.scope,
        key: dto.key,
        label: dto.label,
        helpText: dto.helpText ?? null,
        type: dto.type,
        required: dto.required ?? false,
        constraints: (dto.constraints ?? {}) as ServiceAttribute['constraints'],
        filterable: dto.filterable ?? false,
        sortOrder: dto.sortOrder ?? 0,
      }),
    );

    await this.audit.record({
      action: AuditAction.CATALOG_ATTRIBUTE_CHANGED,
      actor,
      resourceType: 'service_attribute',
      resourceId: saved.id,
      metadata: { definitionId, key: saved.key, scope: saved.scope, change: 'created' },
    });
    return saved;
  }

  async updateAttribute(
    actor: AuthUser,
    id: string,
    dto: UpdateAttributeDto,
  ): Promise<ServiceAttribute> {
    const attribute = await this.attributes.findOne({ where: { id } });
    if (!attribute) throw new NotFoundException('Attribute not found');

    if (dto.constraints) {
      this.assertConstraintsMakeSense({ type: attribute.type, constraints: dto.constraints });
    }

    Object.assign(attribute, {
      label: dto.label ?? attribute.label,
      helpText: dto.helpText ?? attribute.helpText,
      required: dto.required ?? attribute.required,
      constraints: (dto.constraints ?? attribute.constraints) as ServiceAttribute['constraints'],
      filterable: dto.filterable ?? attribute.filterable,
      sortOrder: dto.sortOrder ?? attribute.sortOrder,
    });
    const saved = await this.attributes.save(attribute);

    await this.audit.record({
      action: AuditAction.CATALOG_ATTRIBUTE_CHANGED,
      actor,
      resourceType: 'service_attribute',
      resourceId: saved.id,
      metadata: { key: saved.key, change: 'updated' },
    });
    return saved;
  }

  /**
   * Removes an attribute from a form.
   *
   * Answers already stored under its key are left alone. `validateAttributes`
   * drops unknown keys on the next write, so the data ages out rather than
   * turning every existing listing into a validation failure.
   */
  async removeAttribute(actor: AuthUser, id: string): Promise<{ success: true }> {
    const attribute = await this.attributes.findOne({ where: { id } });
    if (!attribute) throw new NotFoundException('Attribute not found');

    await this.attributes.remove(attribute);
    await this.audit.record({
      action: AuditAction.CATALOG_ATTRIBUTE_CHANGED,
      actor,
      resourceType: 'service_attribute',
      resourceId: id,
      metadata: { key: attribute.key, change: 'removed' },
    });
    return { success: true };
  }

  /**
   * Catches the configuration mistakes that would otherwise surface as a form
   * nobody can fill in — a select with no options, a range whose floor is above
   * its ceiling.
   */
  private assertConstraintsMakeSense(dto: {
    type: CreateAttributeDto['type'];
    constraints?: CreateAttributeDto['constraints'];
  }): void {
    const c = dto.constraints ?? {};
    const needsOptions = ['single_select', 'multi_select'].includes(dto.type);

    if (needsOptions && (!c.options || c.options.length === 0)) {
      throw new BadRequestException('A select attribute needs at least one option');
    }
    if (c.options) {
      const values = c.options.map((o) => o.value);
      if (new Set(values).size !== values.length) {
        throw new BadRequestException('Two options share the same value');
      }
    }
    if (c.min !== undefined && c.max !== undefined && c.min > c.max) {
      throw new BadRequestException('The minimum is above the maximum');
    }
    if (
      c.minSelections !== undefined &&
      c.maxSelections !== undefined &&
      c.minSelections > c.maxSelections
    ) {
      throw new BadRequestException('The minimum number of choices is above the maximum');
    }
  }
}
