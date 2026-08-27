import { ChangeEvent, useRef, useState } from 'react';
import { api, apiMessage } from '../lib/api';

/** Kept in step with `UPLOAD_IMAGE_EXTENSIONS` on the API. */
const IMAGE_EXTENSIONS = [
  'jpg', 'jpeg', 'jpe', 'jfif', 'pjpeg', 'png', 'apng', 'webp',
  'gif', 'bmp', 'avif', 'heic', 'heif', 'tif', 'tiff',
];

/**
 * Picks a file, uploads it, and hands back the URL it now lives at.
 *
 * The profile editors used to take a URL and nothing else, which meant an agent
 * had to upload the photograph somewhere else first and paste a link back in —
 * so in practice profiles had no photographs on them at all. The media module
 * had presigned uploads the whole time; the two were simply never connected.
 *
 * The file goes straight from the browser to storage. It never passes through
 * the API, which is what keeps a fifty-megabyte upload from occupying a request
 * worker for the length of somebody's phone connection.
 */
export default function PhotoUploader({
  onUploaded,
  label = 'Upload a photo',
  kind = 'photo',
}: {
  onUploaded: (url: string) => void;
  label?: string;
  /**
   * What is being attached.
   *
   * A profile photograph must be an image — a PDF there renders as a broken
   * box on somebody's biodata. Evidence on a support case is whatever proves
   * the point, and in practice that is as often an invoice as a photograph.
   */
  kind?: 'photo' | 'attachment';
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError('');
    /*
     * Judged on the extension as well as the reported type, because the type is
     * not always reported. Windows hands over an empty `file.type` for HEIC and
     * for AVIF unless the codec is installed, so a photograph straight off an
     * iPhone looked to this check like something that was not an image at all —
     * which is what "it is not taking all types of images" was describing.
     */
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    const looksLikeImage = file.type.startsWith('image/') || IMAGE_EXTENSIONS.includes(extension);
    const isDocument =
      kind === 'attachment' && (file.type === 'application/pdf' || extension === 'pdf');
    if (!looksLikeImage && !isDocument) {
      setError(
        kind === 'attachment'
          ? 'Choose an image or a PDF.'
          : 'Choose an image file — JPEG, PNG, WebP, HEIC and the rest are all fine.',
      );
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('That photo is over 10MB. Choose a smaller one.');
      return;
    }

    setBusy(true);
    try {
      const { data } = await api.post(
        kind === 'attachment' ? '/media/attachment/presign' : '/media/profile-photo/presign',
        { filename: file.name },
      );

      const response = await fetch(data.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });
      if (!response.ok) throw new Error(`Storage returned ${response.status}`);

      onUploaded(data.publicUrl);
    } catch (err) {
      setError(apiMessage(err, 'That photo could not be uploaded.'));
    } finally {
      setBusy(false);
      // Clearing the input matters: without it, choosing the same file twice
      // fires no change event and looks like the button has stopped working.
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        /*
         * The extensions are listed alongside `image/*` rather than instead of
         * it: the picker on Windows will not offer a HEIC file under `image/*`
         * alone, so the file the person came to upload is greyed out.
         */
        accept={
          kind === 'attachment'
            ? `image/*,application/pdf,.pdf,${IMAGE_EXTENSIONS.map((e) => `.${e}`).join(',')}`
            : `image/*,${IMAGE_EXTENSIONS.map((e) => `.${e}`).join(',')}`
        }
        className="hidden"
        onChange={pick}
        disabled={busy}
      />
      <button
        type="button"
        className="btn-outline"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? 'Uploading…' : label}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
