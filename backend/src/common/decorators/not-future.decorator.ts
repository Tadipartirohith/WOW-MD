import { ValidationOptions, registerDecorator } from 'class-validator';

/**
 * Refuses a date that has not happened yet.
 *
 * For the dates that record something already true: when somebody was born,
 * when they gave their consent, when an agency started trading. All three
 * accepted the future — the report found "Trading since 14-12-2049" saved
 * without complaint — and a date of birth in 2049 is not a typo the platform
 * should keep, because everything downstream reads age off it.
 *
 * Today is allowed. Consent given this morning and a business opened this
 * week are both ordinary, and a validator that refused them would be wrong
 * more often than the input it was catching.
 *
 * Compared on the calendar day rather than the instant: these are dates, not
 * timestamps, and the person filling the form is in their own timezone. An
 * instant comparison refuses "today" for anybody east of the server for part
 * of the day, which is a bug that only shows up in production and only for
 * some users.
 */
export function IsNotFutureDate(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNotFutureDate',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          // Absence is somebody else's rule; @IsOptional decides that.
          if (value === undefined || value === null || value === '') return true;
          if (typeof value !== 'string') return false;

          const given = new Date(value);
          if (Number.isNaN(given.getTime())) return true; // @IsDateString reports the shape.

          const endOfToday = new Date();
          endOfToday.setHours(23, 59, 59, 999);
          return given.getTime() <= endOfToday.getTime();
        },
        defaultMessage() {
          return `${propertyName} cannot be in the future`;
        },
      },
    });
  };
}
