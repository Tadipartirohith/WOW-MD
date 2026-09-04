import { applyDecorators } from '@nestjs/common';
import {
  IsNumber,
  IsString,
  ValidationOptions,
  type IsNumberOptions,
} from 'class-validator';

/**
 * Type checks that mean what they say, under a pipe that otherwise coerces.
 *
 * The global ValidationPipe runs with `enableImplicitConversion`, which is
 * there so a `?page=2` query string becomes the number a DTO asks for. The
 * side effect is that it also quietly turns a JSON `true` into `1` and a JSON
 * `123` into `"123"` in a request body, before any validator sees it — so a
 * boolean `amount` was accepted as a ₹1 booking (EZ1-I53), a boolean
 * `totalBudget` as a budget of 1 (EZ1-I55), and a numeric `gender` stored as
 * the string "123" (EZ1-I54).
 *
 * That implicit conversion only fires for a primitive reflected design type
 * (Number, String, Boolean, Date). Overwriting the design type with `Object`
 * on just these properties opts them out of it — the value reaches `@IsNumber`
 * / `@IsString` as the JSON type it actually arrived as, and anything that was
 * not that type to begin with is rejected. The rest of the app keeps implicit
 * conversion, so numeric query and path parameters still work, and body fields
 * that pass a numeric string through `@Type(() => Number)` are untouched.
 *
 * The TypeScript property keeps its real type; only the reflected metadata that
 * class-transformer reads is changed. Swagger is unaffected — every field that
 * uses these carries its own `@ApiProperty`.
 */
function withoutImplicitCoercion(): PropertyDecorator {
  return (target, propertyKey) =>
    Reflect.defineMetadata('design:type', Object, target, propertyKey);
}

export function IsStrictNumber(numberOptions?: IsNumberOptions, options?: ValidationOptions) {
  return applyDecorators(withoutImplicitCoercion(), IsNumber(numberOptions, options));
}

export function IsStrictString(options?: ValidationOptions) {
  return applyDecorators(withoutImplicitCoercion(), IsString(options));
}
