import { BadRequestException } from '@nestjs/common';
import { describeForm, validateAttributes } from './attribute-validation';
import { ServiceAttribute } from './entities/service-attribute.entity';
import { AttributeScope, ServiceAttributeType as T } from '../../common/enums';

/**
 * The validator is what makes a configuration-driven catalog safe to store as
 * jsonb. If it is wrong, "guest count" becomes 250, "250" and "around 250" in
 * three different rows and nothing can ever filter on it again.
 */

let seq = 0;
const attr = (over: Partial<ServiceAttribute>): ServiceAttribute =>
  ({
    id: `a${(seq += 1)}`,
    definitionId: 'd1',
    scope: AttributeScope.SERVICE,
    key: 'field',
    label: 'Field',
    helpText: null,
    type: T.TEXT,
    required: false,
    constraints: {},
    filterable: false,
    sortOrder: 0,
    ...over,
  }) as ServiceAttribute;

/** The message of the first field-level error, which is what the API surfaces. */
const messageOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    const body = (error as BadRequestException).getResponse() as { message: string };
    return body.message;
  }
  return '';
};

const run = (attributes: ServiceAttribute[], input: Record<string, unknown>) =>
  validateAttributes(attributes, AttributeScope.SERVICE, input);

describe('validateAttributes', () => {
  describe('presence', () => {
    it('refuses a missing required answer, naming the field', () => {
      const a = [attr({ key: 'crew', label: 'Crew size', type: T.NUMBER, required: true })];
      expect(messageOf(() => run(a, {}))).toBe('Crew size is required');
    });

    it('treats an empty string as absent rather than as an answer', () => {
      const a = [attr({ key: 'crew', label: 'Crew size', type: T.NUMBER, required: true })];
      expect(() => run(a, { crew: '' })).toThrow(BadRequestException);
    });

    it('treats an empty list as absent, so a required multi-select is caught', () => {
      const a = [
        attr({
          key: 'styles',
          type: T.MULTI_SELECT,
          required: true,
          constraints: { options: [{ value: 'candid', label: 'Candid' }] },
        }),
      ];
      expect(() => run(a, { styles: [] })).toThrow(BadRequestException);
    });

    it('omits an optional answer nobody gave rather than storing null', () => {
      const a = [attr({ key: 'crew', type: T.NUMBER })];
      // "Not asked" is not "answered zero". Storing null would make the two
      // indistinguishable, which is the mistake the horoscope flag made.
      expect(run(a, {})).toEqual({});
    });

    it('drops an answer to a question that is no longer asked', () => {
      // An administrator retiring an attribute must not turn every listing
      // that still carries its answer into a 400.
      const a = [attr({ key: 'crew', type: T.NUMBER })];
      expect(run(a, { crew: 2, retired: 'whatever' })).toEqual({ crew: 2 });
    });

    it('only looks at attributes in the scope being validated', () => {
      const a = [
        attr({ key: 'crew', type: T.NUMBER, scope: AttributeScope.SERVICE }),
        attr({ key: 'when', type: T.DATE, required: true, scope: AttributeScope.BOOKING }),
      ];
      expect(run(a, { crew: 2 })).toEqual({ crew: 2 });
    });
  });

  describe('numbers', () => {
    it('coerces a number that arrived from a form as a string', () => {
      const a = [attr({ key: 'crew', type: T.NUMBER })];
      expect(run(a, { crew: '3' })).toEqual({ crew: 3 });
    });

    it('refuses a fractional answer to a whole-number question', () => {
      const a = [attr({ key: 'crew', label: 'Crew size', type: T.NUMBER })];
      expect(messageOf(() => run(a, { crew: 2.5 }))).toBe('Crew size must be a whole number');
    });

    it('enforces both bounds, and says which one broke', () => {
      const a = [attr({ key: 'crew', label: 'Crew size', type: T.NUMBER, constraints: { min: 1, max: 10 } })];
      expect(messageOf(() => run(a, { crew: 0 }))).toBe('Crew size must be at least 1');
      expect(messageOf(() => run(a, { crew: 11 }))).toBe('Crew size must be at most 10');
      expect(run(a, { crew: 10 })).toEqual({ crew: 10 });
    });

    it('rounds a decimal to its configured precision', () => {
      const a = [attr({ key: 'rate', type: T.DECIMAL, constraints: { precision: 2 } })];
      expect(run(a, { rate: 1.23456 })).toEqual({ rate: 1.23 });
    });

    it('rounds currency to two places by default, and refuses a negative amount', () => {
      const a = [attr({ key: 'price', label: 'Price', type: T.CURRENCY })];
      expect(run(a, { price: '450.789' })).toEqual({ price: 450.79 });
      expect(messageOf(() => run(a, { price: -1 }))).toBe('Price cannot be negative');
    });

    it('refuses a duration of zero — nobody books nothing', () => {
      const a = [attr({ key: 'hours', type: T.DURATION, constraints: { unit: 'hours' } })];
      expect(() => run(a, { hours: 0 })).toThrow(BadRequestException);
      expect(run(a, { hours: 6 })).toEqual({ hours: 6 });
    });
  });

  describe('choices', () => {
    const options = [
      { value: 'veg', label: 'Vegetarian' },
      { value: 'non_veg', label: 'Non-vegetarian' },
    ];

    it('refuses a single choice that is not on the list, and lists what is', () => {
      const a = [attr({ key: 'diet', label: 'Diet', type: T.SINGLE_SELECT, constraints: { options } })];
      expect(messageOf(() => run(a, { diet: 'vegan' }))).toBe('Diet must be one of: veg, non_veg');
    });

    it('refuses a multi-select answer that is not a list', () => {
      const a = [attr({ key: 'diet', label: 'Diet', type: T.MULTI_SELECT, constraints: { options } })];
      expect(messageOf(() => run(a, { diet: 'veg' }))).toBe('Diet must be a list of choices');
    });

    it('names the offending choice in a multi-select', () => {
      const a = [attr({ key: 'diet', label: 'Diet', type: T.MULTI_SELECT, constraints: { options } })];
      expect(messageOf(() => run(a, { diet: ['veg', 'vegan'] }))).toContain('vegan');
    });

    it('collapses duplicates silently — a repeated choice is a client bug', () => {
      const a = [attr({ key: 'diet', type: T.MULTI_SELECT, constraints: { options } })];
      expect(run(a, { diet: ['veg', 'veg'] })).toEqual({ diet: ['veg'] });
    });

    it('enforces how many may be chosen', () => {
      const a = [
        attr({
          key: 'diet',
          label: 'Diet',
          type: T.MULTI_SELECT,
          constraints: { options, minSelections: 2, maxSelections: 2 },
        }),
      ];
      expect(messageOf(() => run(a, { diet: ['veg'] }))).toBe('Diet choose at least 2');
      expect(run(a, { diet: ['veg', 'non_veg'] })).toEqual({ diet: ['veg', 'non_veg'] });
    });

    it('counts a duplicate once when checking the minimum', () => {
      // Otherwise sending the same choice twice satisfies "choose at least 2".
      const a = [
        attr({
          key: 'diet',
          type: T.MULTI_SELECT,
          constraints: { options, minSelections: 2 },
        }),
      ];
      expect(() => run(a, { diet: ['veg', 'veg'] })).toThrow(BadRequestException);
    });
  });

  describe('dates and times', () => {
    it('accepts an ISO date and refuses anything else', () => {
      const a = [attr({ key: 'day', label: 'Day', type: T.DATE })];
      expect(run(a, { day: '2026-11-21' })).toEqual({ day: '2026-11-21' });
      expect(messageOf(() => run(a, { day: '21/11/2026' }))).toBe('Day must be a date (YYYY-MM-DD)');
    });

    it('refuses a date that parses as a string but is not a real day', () => {
      const a = [attr({ key: 'day', type: T.DATE })];
      expect(() => run(a, { day: '2026-13-45' })).toThrow(BadRequestException);
    });

    it('normalises a time with seconds down to HH:MM', () => {
      const a = [attr({ key: 'at', type: T.TIME })];
      expect(run(a, { at: '18:30:00' })).toEqual({ at: '18:30' });
    });

    it('refuses an impossible clock time', () => {
      const a = [attr({ key: 'at', type: T.TIME })];
      expect(() => run(a, { at: '25:00' })).toThrow(BadRequestException);
    });

    it('normalises a date-time to ISO so two answers can be compared', () => {
      const a = [attr({ key: 'when', type: T.DATE_TIME })];
      expect(run(a, { when: '2026-11-21T09:30:00.000Z' })).toEqual({
        when: '2026-11-21T09:30:00.000Z',
      });
    });
  });

  describe('the rest', () => {
    it('accepts yes and no however the form spelled them', () => {
      const a = [attr({ key: 'ac', label: 'Air conditioned', type: T.BOOLEAN })];
      expect(run(a, { ac: 'true' })).toEqual({ ac: true });
      expect(run(a, { ac: false })).toEqual({ ac: false });
      expect(messageOf(() => run(a, { ac: 'maybe' }))).toBe('Air conditioned must be yes or no');
    });

    it('requires a URL to carry a scheme', () => {
      const a = [attr({ key: 'site', type: T.URL })];
      expect(() => run(a, { site: 'example.com' })).toThrow(BadRequestException);
      expect(run(a, { site: 'https://example.com/work' })).toEqual({
        site: 'https://example.com/work',
      });
    });

    it('trims text and enforces its length', () => {
      const a = [attr({ key: 'about', type: T.TEXT, constraints: { maxLength: 5 } })];
      expect(run(a, { about: '  hi  ' })).toEqual({ about: 'hi' });
      expect(() => run(a, { about: 'far too long' })).toThrow(BadRequestException);
    });

    it('checks an uploaded file against the extensions the attribute accepts', () => {
      const a = [attr({ key: 'ref', type: T.FILE, constraints: { accept: ['.jpg', '.png'] } })];
      expect(run(a, { ref: 'https://cdn.example.com/a.png?v=2' })).toEqual({
        ref: 'https://cdn.example.com/a.png?v=2',
      });
      expect(() => run(a, { ref: 'https://cdn.example.com/a.exe' })).toThrow(BadRequestException);
    });

    it('needs at least a city for a location, which is what people search by', () => {
      const a = [attr({ key: 'where', label: 'Where', type: T.LOCATION })];
      expect(messageOf(() => run(a, { where: { lat: 17.4, lng: 78.4 } }))).toBe(
        'Where needs at least a city',
      );
      expect(run(a, { where: { city: ' Hyderabad ' } })).toEqual({
        where: { label: 'Hyderabad', city: 'Hyderabad' },
      });
    });

    it('refuses half a coordinate pair', () => {
      const a = [attr({ key: 'where', type: T.LOCATION })];
      expect(() => run(a, { where: { city: 'Hyderabad', lat: 17.4 } })).toThrow(BadRequestException);
    });

    it('refuses a range that starts after it ends, and bounds both edges', () => {
      const a = [attr({ key: 'budget', label: 'Budget', type: T.RANGE, constraints: { max: 100 } })];
      expect(messageOf(() => run(a, { budget: { from: 50, to: 10 } }))).toBe(
        'Budget starts after it ends',
      );
      expect(() => run(a, { budget: { from: 10, to: 500 } })).toThrow(BadRequestException);
      expect(run(a, { budget: { from: 10, to: 50 } })).toEqual({ budget: { from: 10, to: 50 } });
    });
  });

  it('reports every failure, not just the first', () => {
    const a = [
      attr({ key: 'one', label: 'One', type: T.NUMBER, required: true }),
      attr({ key: 'two', label: 'Two', type: T.NUMBER, required: true }),
    ];
    try {
      run(a, {});
      fail('should have thrown');
    } catch (error) {
      const body = (error as BadRequestException).getResponse() as {
        errors: { key: string }[];
        code: string;
      };
      expect(body.code).toBe('ATTRIBUTE_VALIDATION_FAILED');
      expect(body.errors.map((e) => e.key)).toEqual(['one', 'two']);
    }
  });
});

describe('describeForm', () => {
  it('returns only the scope asked for, in the configured order', () => {
    const attributes = [
      attr({ key: 'b', scope: AttributeScope.SERVICE, sortOrder: 20 }),
      attr({ key: 'a', scope: AttributeScope.SERVICE, sortOrder: 10 }),
      attr({ key: 'x', scope: AttributeScope.BOOKING, sortOrder: 0 }),
    ];
    expect(describeForm(attributes, AttributeScope.SERVICE).map((f) => f.key)).toEqual(['a', 'b']);
    expect(describeForm(attributes, AttributeScope.BOOKING).map((f) => f.key)).toEqual(['x']);
  });

  it('falls back to the label when two attributes share a sort order', () => {
    const attributes = [
      attr({ key: 'z', label: 'Zebra', sortOrder: 0 }),
      attr({ key: 'a', label: 'Apple', sortOrder: 0 }),
    ];
    expect(describeForm(attributes, AttributeScope.SERVICE).map((f) => f.key)).toEqual(['a', 'z']);
  });
});
