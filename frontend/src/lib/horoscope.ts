/**
 * The horoscope chart, and how to draw whatever was attached.
 *
 * A family attaches whatever they have: a photograph of the chart their priest
 * drew, a scan, or the PDF an astrologer emailed them. Both are accepted on the
 * upload and both have to be shown — so the one decision every view of the
 * chart needs is whether this file can be rendered or only opened. Drawing a
 * PDF into an `<img>` produces a broken-image icon, which reads as an upload
 * that failed (EZ1-I231).
 *
 * Pure, and the same rule in every client: the web profile views, the biodata
 * editor, and the app.
 */

/** Extensions a browser or a phone will render inline. */
const RENDERABLE = /\.(png|jpe?g|jpe|jfif|pjpeg|webp|gif|avif|heic|heif|bmp)(\?|$)/i;

/**
 * Whether this chart can be shown as a picture.
 *
 * Judged on the stored path rather than on a content type, because the URL is
 * all any of these views has. Anything else — a PDF, or a format nobody
 * anticipated — is offered as a link, which is the safe answer either way.
 */
export function isChartImage(url: string | null | undefined): boolean {
  return Boolean(url) && RENDERABLE.test(String(url));
}
