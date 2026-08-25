import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';

/**
 * A boolean that will not be talked into being true.
 *
 * The application validates with `enableImplicitConversion`, which converts a
 * body or query value to the property's declared type before validation runs.
 * For a number that is a convenience — `?limit=25` arrives as a string and
 * should be 25. For a boolean it is a trap: the conversion treats any
 * non-empty string as `true`, so `"no"`, `"off"` and, worst of all, `"false"`
 * all mean yes.
 *
 * For a page filter that is a shrug. For a field that decides whether somebody
 * is messaged on WhatsApp, whether their biodata is circulated outside the
 * agency that holds it, or whether their account is suspended, it is a defect
 * with a person on the other end of it. Those fields use this instead.
 *
 * The property it decorates must be declared `boolean | string`, and that is
 * load-bearing rather than sloppy: the implicit conversion is driven by the
 * single reflected type, and a union has none, so the conversion stands down
 * and the raw value reaches `@IsBoolean`. The transform below then accepts the
 * two strings that unambiguously mean a boolean — a JSON form posting
 * `"true"` is a real client, not an attack — and lets everything else be
 * refused.
 *
 * Read the value with `=== true` at the call site.
 */
export function StrictBoolean(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }) => {
      if (value === true || value === 'true') return true;
      if (value === false || value === 'false') return false;
      return value;
    }),
    IsBoolean(),
  );
}
