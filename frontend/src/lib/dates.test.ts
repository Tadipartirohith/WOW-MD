import { describe, expect, it } from 'vitest';
import { NOT_SET, formatDate } from './dates';

/**
 * The parser behind every date the platform renders.
 *
 * These exist because the zero-date guard was written as "at or before the
 * epoch", which is true of a converted null and also true of anyone born
 * before 1970 -- so a parent's own date of birth read "Date not set" forever
 * (EZ1-I236).
 */
describe('formatDate', () => {
  it('renders a date of birth from before 1970', () => {
    // The case from the report: a family member born in 1968.
    expect(formatDate('1968-04-22')).not.toBe(NOT_SET);
    expect(formatDate('1968-04-22')).toContain('1968');
  });

  it('renders an ordinary date', () => {
    expect(formatDate('2001-07-15')).toContain('2001');
  });

  it('keeps the day somebody typed, rather than shifting it a day earlier', () => {
    // A bare YYYY-MM-DD parsed as UTC renders as the previous day in India.
    expect(formatDate('2001-07-15')).toContain('15');
  });

  it.each([null, undefined, '', '   ', 'null', 'undefined', '0', 'not a date'])(
    'says so in words for %j',
    (value) => {
      expect(formatDate(value as string | null | undefined)).toBe(NOT_SET);
    },
  );

  it('still rejects a stringified epoch, which is a converted zero', () => {
    expect(formatDate('1970-01-01T00:00:00.000Z')).toBe(NOT_SET);
  });

  it('takes a caller-supplied fallback', () => {
    expect(formatDate(null, 'Ask them')).toBe('Ask them');
  });
});
