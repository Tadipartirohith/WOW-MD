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

/** The words that stand for a single digit, for the mixed-form pass below. */
const DIGIT_WORD =
  'zero|one|two|three|four|five|six|seven|eight|nine|oh|nought|double|triple';

/**
 * A number written half in words and half in figures.
 *
 * "nine eight 7 six 5 four 3 two 1 zero" is a complete phone number and every
 * pattern above lets it through: the figures break the spelled run into pieces
 * too short to match, and the words break the digit run the same way. It is
 * not a hypothetical — alternating the two is the obvious next thing to try
 * once somebody notices that neither form works on its own, and the
 * requirement names it.
 *
 * So this matches a *run* of number-ish tokens — a group of figures or a digit
 * word — separated by nothing but spaces and light punctuation, and then counts
 * how many digits the run is worth. Ten or more and it is redacted whole.
 *
 * Counting rather than pattern-matching is what keeps it honest in both
 * directions. "we expect 300 guests and 12 tables" has words between the
 * numbers, so it is two runs of three and two digits and survives untouched;
 * "one lakh" is two digits' worth and survives; a ten-digit number survives
 * nothing, however it is spelled.
 */
const MIXED_RUN = new RegExp(
  `(?:\\d+|\\b(?:${DIGIT_WORD})\\b)(?:[\\s.,-]*(?:\\d+|\\b(?:${DIGIT_WORD})\\b))+`,
  'gi',
);

/** How many digits a run is actually worth. A word is one; "12" is two. */
function digitsIn(run: string): number {
  const matches = run.match(new RegExp(`\\d+|\\b(?:${DIGIT_WORD})\\b`, 'gi'));
  const tokens: string[] = matches ? Array.from(matches) : [];

  let total = 0;
  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      total += token.length;
      continue;
    }
    // "double" and "triple" announce a repeat rather than being a digit
    // themselves, and are worth what they add: one and two more.
    const word = token.toLowerCase();
    if (word === 'double') total += 1;
    else if (word === 'triple') total += 2;
    else total += 1;
  }
  return total;
}

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

  // The mixed form goes before the spelled-out one, and the order is the whole
  // point. Run it after, and the spelled pass has already eaten the tail of
  // "nine eight 76 five four three two one zero" — leaving "nine eight 76"
  // sitting in the message next to the redaction marker, which is four digits
  // of a phone number published under a notice saying it was removed.
  text = text.replace(MIXED_RUN, (run) => {
    if (digitsIn(run) < 10) return run;
    redactions += 1;
    return REPLACEMENT;
  });

  // Still worth its own pass: five spelled digits are not a whole number but
  // are nobody's ordinary sentence either.
  text = swap(text, SPELLED_DIGITS);

  text = swap(text, HANDLES);

  return { text, redactions };
}
