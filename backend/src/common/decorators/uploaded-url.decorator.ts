import { IsUrl, ValidationOptions } from 'class-validator';

/**
 * A URL for something that was uploaded — a photograph, a document, evidence.
 *
 * `@IsUrl({ require_protocol: true })` looks like the obvious choice and is
 * subtly wrong for these fields, because it also requires a top-level domain.
 * The platform's own presign hands back
 * `http://localhost:3000/mock-storage/...` in development, and an internal
 * hostname like `http://minio:9000/...` in a self-hosted deployment — neither
 * has a TLD, so every field that stored an uploaded file refused the URL the
 * platform had just issued for it.
 *
 * It survived because the live suites post literal `https://cdn.example.com/…`
 * strings, which do have a TLD. Nothing ever fed a real presigned URL back into
 * the API the way the browser does, so the whole upload path passed its tests
 * and failed for every user on a deployment whose storage host was not a public
 * domain. The reported symptom — "attaching a photo to a support case does not
 * work" — was this.
 *
 * The protocol is still required. That is the part that matters: it is what
 * stops `javascript:` and a bare path being stored and later rendered.
 */
export function IsUploadedUrl(options?: ValidationOptions): PropertyDecorator {
  return IsUrl({ require_protocol: true, require_tld: false }, options);
}
