/**
 * Strips contact details out of chat messages.
 *
 * Two sides talking off-platform is how people get hurt here: the platform
 * loses the record, and with it any ability to investigate what was said or to
 * settle a dispute afterwards. So phone numbers, email addresses and the usual
 * "ping me on WhatsApp" handles are replaced before a message is stored — not
 * after, and not only on display, because a message that reaches the database
 * intact has already leaked.
 *
 * This is deliberately blunt. It will occasionally redact a long number that
 * was not a phone number, which is the right trade: a mangled guest count is a
 * nuisance, a leaked number is the thing the rule exists to prevent.
 */

const REPLACEMENT = '[contact removed]';

/**
 * Indian mobile numbers, with or without +91, and with spaces, dashes or dots
 * between the digits — which is how people actually type them when they are
 * trying to slip one past a filter.
 */
const PHONE = /(?:(?:\+|00)?91[\s.-]?)?[6-9](?:[\s.-]?\d){9}/g;

/** Any 10-or-more digit run that survived the pattern above. */
const LONG_DIGITS = /\d(?:[\s.-]?\d){9,}/g;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Digits spelled out, e.g. "nine eight seven six ...". Only redacted when five
 * or more run together, which no ordinary sentence does.
 */
const SPELLED_DIGITS =
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|oh|double)\b(?:[\s,.-]+\b(?:zero|one|two|three|four|five|six|seven|eight|nine|oh|double)\b){4,}/gi;

/** Messaging handles: "whatsapp 98..." / "my telegram is @x" / "insta: y". */
const HANDLES =
  /\b(?:whats\s?app|wa|telegram|signal|insta(?:gram)?|snap(?:chat)?|fb|facebook)\b[\s:.-]*@?[\w.+-]*/gi;

export interface RedactionResult {
  text: string;
  /** How many substitutions were made. Zero means the message was untouched. */
  redactions: number;
}

export function redactContacts(input: string): RedactionResult {
  let redactions = 0;
  const swap = (text: string, pattern: RegExp): string =>
    text.replace(pattern, () => {
      redactions += 1;
      return REPLACEMENT;
    });

  // Email first: an address contains digit runs that the phone patterns would
  // otherwise chew into, leaving half an address behind.
  let text = swap(input, EMAIL);
  text = swap(text, PHONE);
  text = swap(text, LONG_DIGITS);
  text = swap(text, SPELLED_DIGITS);
  text = swap(text, HANDLES);

  return { text, redactions };
}
