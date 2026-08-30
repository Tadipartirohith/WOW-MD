/**
 * The API error reader, shared with the web client.
 *
 * Worth sharing rather than reimplementing because of what its own comment
 * records: for the whole life of the project it read the wrong level of the
 * error envelope, so every explanation the server produced was replaced by a
 * generic sentence before anyone saw it. "That document could not be recorded"
 * was really *this document is already registered against another profile*.
 * A second copy here would be a second chance to make exactly that mistake, on
 * a platform where the user cannot open a console to find out what really
 * happened.
 */
export * from '../../../frontend/src/lib/api-errors';
