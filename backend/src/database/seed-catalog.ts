import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import dataSource from './data-source';
import { CATALOG_BLUEPRINT } from './catalog-blueprint';
import { ServiceCategory } from '../modules/catalog/entities/service-category.entity';
import { ServiceDefinition } from '../modules/catalog/entities/service-definition.entity';
import { ServiceAttribute } from '../modules/catalog/entities/service-attribute.entity';

loadEnv();

/**
 * Seeds the starting service catalog.
 *
 *   npm run seed:catalog          (source, needs ts-node)
 *   npm run seed:catalog:prod     (compiled, inside the container)
 *
 * Idempotent, and deliberately non-destructive: an administrator who has
 * renamed a category, added an attribute or retired a service keeps those
 * changes. The seed fills in what is missing and updates nothing that already
 * exists. Re-running it after an edit must not quietly undo the edit — that is
 * the failure mode that makes people afraid of seed scripts.
 */
async function main(): Promise<void> {
  await dataSource.initialize();
  try {
    const categories = dataSource.getRepository(ServiceCategory);
    const definitions = dataSource.getRepository(ServiceDefinition);
    const attributes = dataSource.getRepository(ServiceAttribute);

    let addedCategories = 0;
    let addedDefinitions = 0;
    let addedAttributes = 0;

    for (const [categoryIndex, blueprint] of CATALOG_BLUEPRINT.entries()) {
      let category = await categories.findOne({ where: { slug: blueprint.slug } });
      if (!category) {
        category = await categories.save(
          categories.create({
            slug: blueprint.slug,
            name: blueprint.name,
            description: blueprint.description,
            icon: blueprint.icon,
            active: true,
            sortOrder: categoryIndex * 10,
          }),
        );
        addedCategories += 1;
      }

      for (const [definitionIndex, def] of blueprint.definitions.entries()) {
        let definition = await definitions.findOne({
          where: { categoryId: category.id, slug: def.slug },
        });
        if (!definition) {
          definition = await definitions.save(
            definitions.create({
              categoryId: category.id,
              slug: def.slug,
              name: def.name,
              description: def.description,
              allowedPricingModels: def.allowedPricingModels,
              availabilityModel: def.availabilityModel,
              packagesAllowed: def.packagesAllowed,
              defaultCapacity: def.defaultCapacity,
              active: true,
              sortOrder: definitionIndex * 10,
            }),
          );
          addedDefinitions += 1;
        }

        for (const [attrIndex, attr] of def.attributes.entries()) {
          const existing = await attributes.findOne({
            where: { definitionId: definition.id, scope: attr.scope, key: attr.key },
          });
          if (existing) continue;

          await attributes.save(
            attributes.create({
              definitionId: definition.id,
              scope: attr.scope,
              key: attr.key,
              label: attr.label,
              helpText: attr.helpText ?? null,
              type: attr.type,
              required: attr.required ?? false,
              constraints: (attr.constraints ?? {}) as ServiceAttribute['constraints'],
              filterable: attr.filterable ?? false,
              sortOrder: attrIndex * 10,
            }),
          );
          addedAttributes += 1;
        }
      }
    }

    console.log(
      `Catalog seeded: +${addedCategories} categories, +${addedDefinitions} services, ` +
        `+${addedAttributes} attributes. Existing rows were left untouched.`,
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error('Catalog seed failed:', error);
  process.exitCode = 1;
});
