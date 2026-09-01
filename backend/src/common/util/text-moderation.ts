/**
 * A first pass over free text somebody else will read.
 *
 * Deliberately modest about what it is. This is not moderation in the sense of
 * understanding what was meant — a word list cannot do that, and anything
 * claiming to is lying about its own precision. What it does is catch the
 * obvious cases and, crucially, *hold them for a human* rather than refusing
 * them outright.
 *
 * That distinction is the whole design. Refusing a review at the point of
 * writing means arguing with somebody about their own experience, and a false
 * positive there silences a legitimate complaint about a vendor — which is
 * exactly the review a platform has the strongest incentive to lose and the
 * strongest duty to keep. Holding it costs a delay and nothing else: the words
 * are kept verbatim, an administrator reads them, and it publishes or it does
 * not.
 *
 * Threats are the one category treated more seriously, because a threat is
 * about a person rather than about a service.
 */

/** What to do with a piece of text, and why. */
export interface TextVerdict {
  /** True when a person should read it before anybody else does. */
  hold: boolean;
  /** Said plainly, because it is shown to the writer and to the moderator. */
  reason: string | null;
}

const ABUSE = [
  'fuck', 'shit', 'bastard', 'bitch', 'slut', 'whore',
  'idiot', 'moron', 'bloody fool',
];

const THREATS = [
  'kill you', 'kill him', 'kill her', 'beat you', 'beat him', 'beat her',
  'burn your', 'burn his', 'burn her', 'destroy you', 'finish you',
  'see you outside', 'wait and see', 'you will pay for this',
];

/** Leetspeak flattened, punctuation dropped, whitespace squeezed. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[@4]/g, 'a')
    .replace(/[!1|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/0/g, 'o')
    .replace(/[$5]/g, 's')
    .replace(/7/g, 't')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Runs of single letters, glued back into words.
 *
 * "b i t c h" and "a b i t c h" are the same attempt, and the second is why
 * these are checked by substring while ordinary prose is not: the leading "a"
 * is a real word that happens to sit inside the run, so a boundary match on
 * the glued result would miss it. Substring is safe *here* precisely because a
 * letter-spaced run is not something that occurs in ordinary writing — which
 * is what keeps Scunthorpe out of it.
 */
function spacedRuns(text: string): string[] {
  return (text.match(/\b(?:[a-z]\s+){2,}[a-z]\b/g) ?? []).map((run) => run.replace(/\s+/g, ''));
}

/**
 * Word-boundary match, allowing the endings a word actually takes.
 *
 * Without this "bastards" walks straight past a list containing "bastard",
 * which is the kind of gap that makes a filter theatre.
 */
const SUFFIXES = '(?:s|es|ed|ing|er|ers|y)?';

function saysWord(haystack: string, needle: string): boolean {
  const pattern = needle.replace(/\s+/g, '\\s+');
  return new RegExp(`\\b${pattern}${SUFFIXES}\\b`).test(haystack);
}

export function screenText(input: string | null | undefined): TextVerdict {
  const text = normalise(input ?? '');
  if (!text) return { hold: false, reason: null };

  const glued = spacedRuns(text);
  const hidden = (word: string) => glued.some((run) => run.includes(word));

  if (THREATS.some((phrase) => saysWord(text, phrase))) {
    return { hold: true, reason: 'Held for review: it reads as a threat.' };
  }
  if (ABUSE.some((word) => saysWord(text, word) || hidden(word))) {
    return { hold: true, reason: 'Held for review: it contains abusive language.' };
  }

  /*
   * Shouting, which is not abuse but is worth a look.
   *
   * Only past a length where it stops being an abbreviation or an emphasised
   * word: "OK" and "AVOID" are fine, forty capitals is somebody upset.
   */
  const letters = (input ?? '').replace(/[^A-Za-z]/g, '');
  if (letters.length >= 40 && letters === letters.toUpperCase()) {
    return { hold: true, reason: 'Held for review: written entirely in capitals.' };
  }

  return { hold: false, reason: null };
}
