/**
 * Makes a user's search text safe to drop inside a LIKE / ILIKE pattern.
 *
 * `%` and `_` are wildcards there, so somebody typing "%" into a city box
 * would otherwise match every row — a confusing answer to a search rather
 * than a dangerous one, but still not the answer they asked for. The
 * backslash is escaped first, or escaping the others would corrupt it.
 *
 * Parameter binding already handles quoting; this is only about the pattern
 * language, which binding knows nothing about.
 */
export function likeEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/[%_]/g, (c) => `\\${c}`);
}
