/**
 * Date rendering, read from the web client rather than copied.
 *
 * These are the wordings a user already recognises — "Date not set" rather than
 * a blank or a wedding apparently scheduled for 1 January 1970 — and two
 * products in the same brand disagreeing about how a date reads is exactly the
 * kind of small wrongness nobody files a bug about and everybody notices.
 *
 * One caveat that belongs to this platform and not to that file: these call
 * `toLocaleDateString` with options, which needs Intl. Hermes ships it on both
 * platforms now, but if a date ever renders as a bare ISO string on an Android
 * build, that is the reason, and the fix is the Intl-enabled Hermes variant
 * rather than a change to the shared file.
 */
export * from '../../../frontend/src/lib/dates';
