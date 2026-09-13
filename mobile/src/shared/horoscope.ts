/**
 * How a horoscope chart is drawn, read from the web client rather than copied.
 *
 * Whether a file can be shown inline or only opened is the same question in
 * both apps, and answering it twice is how the two ended up disagreeing about
 * what a PDF is (EZ1-I231). Pure, so it crosses the boundary the same way the
 * permission matrix and the notification wording do.
 */
export * from '../../../frontend/src/lib/horoscope';
