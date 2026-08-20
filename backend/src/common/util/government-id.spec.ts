import {
  hashGovernmentId,
  isValidAadhaar,
  isValidGovernmentId,
  lastFour,
  normaliseId,
} from './government-id';
import { GovernmentIdType } from '../enums';

describe('government id', () => {
  describe('Aadhaar', () => {
    it('accepts a number with a correct Verhoeff check digit', () => {
      expect(isValidAadhaar('234567890124')).toBe(true);
    });

    it('rejects a number whose check digit does not hold', () => {
      expect(isValidAadhaar('123456789012')).toBe(false);
    });

    it('rejects the reserved 0 and 1 leading digits', () => {
      expect(isValidAadhaar('034567890124')).toBe(false);
      expect(isValidAadhaar('134567890124')).toBe(false);
    });

    it('ignores the spaces people actually type', () => {
      expect(isValidGovernmentId(GovernmentIdType.AADHAAR, '2345 6789 0124')).toBe(true);
    });
  });

  describe('other documents', () => {
    it('accepts a well-formed passport number', () => {
      expect(isValidGovernmentId(GovernmentIdType.PASSPORT, 'A1234567')).toBe(true);
    });

    it('rejects a passport number of the wrong length', () => {
      expect(isValidGovernmentId(GovernmentIdType.PASSPORT, 'A123456')).toBe(false);
    });

    it('accepts a well-formed PAN', () => {
      expect(isValidGovernmentId(GovernmentIdType.PAN, 'ABCDE1234F')).toBe(true);
    });
  });

  describe('storage', () => {
    it('normalises formatting so the same document always hashes the same', () => {
      expect(normaliseId('2345 6789-0124')).toBe('234567890124');
      const a = hashGovernmentId(GovernmentIdType.AADHAAR, '2345 6789 0124', 'pepper');
      const b = hashGovernmentId(GovernmentIdType.AADHAAR, '234567890124', 'pepper');
      expect(a).toBe(b);
    });

    it('separates documents of different types that share a number', () => {
      const aadhaar = hashGovernmentId(GovernmentIdType.AADHAAR, '234567890124', 'pepper');
      const passport = hashGovernmentId(GovernmentIdType.PASSPORT, '234567890124', 'pepper');
      expect(aadhaar).not.toBe(passport);
    });

    it('produces a different hash under a different pepper', () => {
      const one = hashGovernmentId(GovernmentIdType.AADHAAR, '234567890124', 'pepper-one');
      const two = hashGovernmentId(GovernmentIdType.AADHAAR, '234567890124', 'pepper-two');
      expect(one).not.toBe(two);
    });

    it('never returns the number itself', () => {
      const hash = hashGovernmentId(GovernmentIdType.AADHAAR, '234567890124', 'pepper');
      expect(hash).not.toContain('234567890124');
      expect(hash).toHaveLength(64);
    });

    it('keeps only the last four digits for display', () => {
      expect(lastFour('2345 6789 0124')).toBe('0124');
    });
  });
});
