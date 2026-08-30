/**
 * The permission matrix, read from the web client rather than copied.
 *
 * That file is itself a mirror of the server's, kept honest by a test that
 * reads the backend enum off disk (frontend/src/lib/permissions.test.ts). Its
 * comment argues against generating a shared package — "in one repository,
 * reading the original is both simpler and harder to get wrong" — and the same
 * argument applies once more here. A third hand-written copy would be a third
 * chance for the navigation to hide a screen from somebody entitled to it, or
 * to offer one that only ever answers 403.
 *
 * A re-export rather than a Metro alias because a relative path is something
 * Metro resolves natively and a reader can follow; the only build config this
 * needs is the watch folder in metro.config.js.
 */
export * from '../../../frontend/src/lib/permissions';
