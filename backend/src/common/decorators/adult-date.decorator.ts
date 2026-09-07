import { ValidationOptions, registerDecorator } from 'class-validator';

/**
 * Refuses a date of birth that makes the person younger than `minAge`, and a
 * date so far in the past that it cannot be a real birth date.
 *
 * The platform is for adults arranging a marriage: a client, vendor or planner
 * under 18 has no business being onboarded, yet the forms accepted "under 18"
 * and even "hundreds or thousands of years ago" without complaint (EZ1-I101,
 * EZ1-I85). Age is read straight off this field everywhere downstream, so it is
 * validated where it enters.
 *
 * Compared on the calendar day, not the instant, for the same reason
 * @IsNotFutureDate is: these are dates, and the person is in their own timezone.
 * Exactly `minAge` years old today is allowed — the 18th birthday counts.
 */
export function IsAdultDate(minAge = 18, options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isAdultDate',
      target: object.constructor,
      propertyName,
      constraints: [minAge],
      options,
      validator: {
        validate(value: unknown) {
          // Absence is somebody else's rule; @IsOptional decides that.
          if (value === undefined || value === null || value === '') return true;
          if (typeof value !== 'string') return false;

          const dob = new Date(value);
          if (Number.isNaN(dob.getTime())) return true; // @IsDateString reports the shape.

          const today = new Date();
          // The latest date of birth that is already `minAge` years old today.
          const cutoff = new Date(
            today.getFullYear() - minAge,
            today.getMonth(),
            today.getDate(),
            23,
            59,
            59,
            999,
          );
          if (dob.getTime() > cutoff.getTime()) return false;

          // A birth date more than 120 years ago is not a real person.
          const floor = new Date(today.getFullYear() - 120, today.getMonth(), today.getDate());
          return dob.getTime() >= floor.getTime();
        },
        defaultMessage() {
          return `${propertyName} must make the person at least ${minAge} years old`;
        },
      },
    });
  };
}
