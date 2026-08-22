import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import PhotoUploader from './PhotoUploader';

interface PhotoState {
  photos: string[];
  primaryPhotoUrl: string | null;
  max: number;
}

/**
 * The photographs on a profile.
 *
 * Uploading went straight to storage and back as a URL long before there was
 * anywhere on this page to put one: the only screen that could attach a
 * photograph was the agency console, so a profile somebody managed themselves
 * never had one. That was the reported defect — not that photographs were lost,
 * but that they could never be added in the first place.
 *
 * Everything here reads back from the server after each change, so a photograph
 * that did not save does not linger on screen as though it had.
 */
export default function ProfilePhotos({
  profileId,
  readOnly = false,
}: {
  profileId: string;
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const { data, isLoading } = useQuery<PhotoState>({
    queryKey: ['profile-photos', profileId],
    queryFn: async () => (await api.get(`/profiles/${profileId}/details/photos`)).data,
    enabled: Boolean(profileId),
  });

  async function run(fn: () => Promise<unknown>, marker = '') {
    setError('');
    setBusy(marker);
    try {
      await fn();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['profile-photos', profileId] }),
        // The biodata carries the primary photo, and the profile carries the
        // list, so both go stale on any change here.
        qc.invalidateQueries({ queryKey: ['biodata', profileId] }),
        qc.invalidateQueries({ queryKey: ['me'] }),
      ]);
    } catch (err) {
      setError(apiMessage(err, 'That did not save.'));
    } finally {
      setBusy('');
    }
  }

  const photos = data?.photos ?? [];
  const primary = data?.primaryPhotoUrl ?? null;
  const full = photos.length >= (data?.max ?? 20);

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        The first photograph is the one shown on your profile and on anything circulated. You can
        add up to {data?.max ?? 20}.
      </p>

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}
      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

      <div className="flex flex-wrap gap-3">
        {photos.map((url) => (
          <figure key={url} className="w-32">
            <img
              src={url}
              alt=""
              loading="lazy"
              className={`h-32 w-32 rounded object-cover ${
                url === primary ? 'ring-2 ring-brand' : 'ring-1 ring-gray-200'
              }`}
            />
            <figcaption className="mt-1 space-y-1 text-center">
              {url === primary ? (
                <span className="block text-xs font-medium text-brand">Shown first</span>
              ) : (
                !readOnly && (
                  <button
                    type="button"
                    className="block w-full text-xs text-gray-600 underline hover:text-brand"
                    disabled={busy !== ''}
                    onClick={() =>
                      run(
                        () => api.put(`/profiles/${profileId}/details/primary-photo`, { url }),
                        url,
                      )
                    }
                  >
                    Show this first
                  </button>
                )
              )}
              {!readOnly && (
                <button
                  type="button"
                  className="block w-full text-xs text-gray-500 underline hover:text-red-600"
                  disabled={busy !== ''}
                  onClick={() => {
                    if (confirm('Remove this photograph?')) {
                      void run(
                        () =>
                          api.delete(`/profiles/${profileId}/details/photos`, { data: { url } }),
                        url,
                      );
                    }
                  }}
                >
                  Remove
                </button>
              )}
            </figcaption>
          </figure>
        ))}

        {photos.length === 0 && !isLoading && (
          <p className="text-sm text-gray-400">No photographs yet.</p>
        )}
      </div>

      {!readOnly &&
        (full ? (
          <p className="text-sm text-amber-700">
            That is the maximum. Remove one before adding another.
          </p>
        ) : (
          <PhotoUploader
            label={photos.length === 0 ? 'Add a photograph' : 'Add another'}
            onUploaded={(url) =>
              run(() => api.post(`/profiles/${profileId}/details/photos`, { url }))
            }
          />
        ))}
    </div>
  );
}
