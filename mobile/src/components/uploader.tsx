import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { FileText, Trash, X } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { Body, Button, Caption } from '@/components/ui';
import { radius, rgb, rgba, space, useTheme } from '@/theme';

/**
 * Picking a file and putting it where the platform serves it from.
 *
 * The same two steps the web uploader takes — ask the API to presign, then PUT
 * the bytes straight at storage — because the reason for it is the same on both:
 * a ten-megabyte upload must not occupy a request worker for the length of
 * somebody's phone connection.
 *
 * What is different is how the bytes get into the request, and it is why every
 * portfolio photograph and compliance document failed with "Could not reach the
 * server" (EZ1-I248). This read the file with `fetch('file:///…')` and PUT the
 * resulting blob. There is no file: handler in React Native's networking stack:
 * the read itself fails, as a network error, before anything is sent — which is
 * exactly the message the vendor saw, about a server that was never contacted.
 *
 * The platform's own uploader does the read instead. `createUploadTask` with
 * BINARY_CONTENT streams the file from disk as the request body, which is what
 * a presigned PUT needs — a multipart body with `{ uri, name, type }` would
 * arrive at S3 as a file whose bytes are a MIME envelope — and it reports
 * progress, so a vendor on a slow connection can see that something is
 * happening rather than deciding the app has hung.
 */

/** Kept in step with `UPLOAD_IMAGE_EXTENSIONS` on the API. */
const FALLBACK_EXTENSION = 'jpg';

const IMAGE_EXTENSIONS = [
  'jpg', 'jpeg', 'jpe', 'jfif', 'pjpeg', 'png', 'apng', 'webp',
  'gif', 'bmp', 'avif', 'heic', 'heif', 'tif', 'tiff',
];

/** What the attachment route accepts: an image, or a PDF. */
const DOCUMENT_EXTENSIONS = [...IMAGE_EXTENSIONS, 'pdf'];

/** The server's own MAX_FILE_SIZE default, checked here so a refusal is
 *  immediate rather than ten megabytes later. */
const MAX_BYTES = 10 * 1024 * 1024;

/** A refusal the person can act on, as opposed to one about the network. */
class UploadError extends Error {}

function extensionOf(name: string): string {
  return (name.split('.').pop() ?? '').toLowerCase();
}

async function upload(
  uri: string,
  fileName: string,
  mimeType: string,
  kind: Kind,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const allowed = kind === 'attachment' ? DOCUMENT_EXTENSIONS : IMAGE_EXTENSIONS;
  if (!allowed.includes(extensionOf(fileName))) {
    throw new UploadError(
      kind === 'attachment'
        ? 'Choose an image or a PDF.'
        : 'Choose an image — a JPEG, PNG, HEIC or WebP.',
    );
  }

  // Read the size before asking for an upload slot: a file that is going to be
  // refused should be refused before anything is minted or sent.
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) throw new UploadError('That file could not be read. Choose it again.');
  if (info.size > MAX_BYTES) {
    throw new UploadError('That file is over 10MB. Choose a smaller one.');
  }

  const { data } = await api.post(
    kind === 'attachment' ? '/media/attachment/presign' : '/media/profile-photo/presign',
    { filename: fileName },
  );

  const task = FileSystem.createUploadTask(
    data.uploadUrl,
    uri,
    {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      // The type only. Setting a multipart content type by hand is what breaks
      // an upload that has no boundary to go with it.
      headers: { 'Content-Type': mimeType },
    },
    (progress) => {
      if (!onProgress || !progress.totalBytesExpectedToSend) return;
      onProgress(progress.totalBytesSent / progress.totalBytesExpectedToSend);
    },
  );

  const response = await task.uploadAsync();
  if (!response) throw new UploadError('That upload was interrupted. Try again.');
  if (response.status < 200 || response.status >= 300) {
    throw new UploadError(`Storage refused the file (${response.status}). Try again.`);
  }

  return data.publicUrl as string;
}

type Kind = 'photo' | 'attachment';

export function PhotoPicker({
  label = 'Add a photo',
  kind = 'photo',
  onUploaded,
}: {
  label?: string;
  kind?: Kind;
  onUploaded: (url: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  /** Whatever went wrong, said in words the person can act on. */
  function report(err: unknown, fallback: string) {
    setError(err instanceof UploadError ? err.message : apiMessage(err, fallback));
  }

  async function run(source: 'library' | 'camera') {
    setError('');

    // Asked at the moment of use rather than at launch: a permission prompt a
    // person cannot connect to anything they just did is a permission prompt
    // they refuse.
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(
        source === 'camera'
          ? 'Camera access is off for this app. Turn it on in Settings to take a photo.'
          : 'Photo access is off for this app. Turn it on in Settings to choose one.',
      );
      return;
    }

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.85 })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 0.85,
          });
    if (result.canceled || result.assets.length === 0) return;

    const asset = result.assets[0];
    setBusy(true);
    setProgress(0);
    try {
      const name =
        asset.fileName ?? `upload-${Date.now()}.${asset.uri.split('.').pop() ?? FALLBACK_EXTENSION}`;
      const url = await upload(asset.uri, name, asset.mimeType ?? 'image/jpeg', kind, setProgress);
      onUploaded(url);
    } catch (err) {
      report(err, 'That photo could not be uploaded.');
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  /**
   * A file off the phone rather than a photograph of one.
   *
   * A registration certificate is a PDF that arrived by email, and telling a
   * vendor to photograph their screen was the previous answer to that.
   */
  async function pickDocument() {
    setError('');
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      // Copied into the app's own cache, so the uri stays readable after the
      // picker's temporary grant is gone.
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || result.assets.length === 0) return;

    const asset = result.assets[0];
    setBusy(true);
    setProgress(0);
    try {
      const name = asset.name || `document-${Date.now()}.pdf`;
      const url = await upload(
        asset.uri,
        name,
        asset.mimeType ?? 'application/pdf',
        'attachment',
        setProgress,
      );
      onUploaded(url);
    } catch (err) {
      report(err, 'That document could not be uploaded.');
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  return (
    <View style={{ gap: space(2) }}>
      <View style={{ flexDirection: 'row', gap: space(2) }}>
        <Button
          label={busy ? uploadingLabel(progress) : label}
          variant="outline"
          small
          busy={busy}
          onPress={() => void run('library')}
          style={{ flex: 1 }}
        />
        <Button
          label="Camera"
          variant="outline"
          small
          disabled={busy}
          onPress={() => void run('camera')}
        />
      </View>
      {kind === 'attachment' ? (
        <Button
          label="Choose a PDF or file"
          variant="outline"
          small
          disabled={busy}
          onPress={() => void pickDocument()}
        />
      ) : null}
      {busy ? <ProgressBar fraction={progress} /> : null}
      {error ? <Caption tone="critical">{error}</Caption> : null}
      {kind === 'attachment' ? (
        <Caption tone="faint">
          A PDF, or a photograph of the document — the officer checks what it says, not what it was
          scanned on. Up to 10MB.
        </Caption>
      ) : null}
    </View>
  );
}

/** "Uploading… 40%", or just "Uploading…" until the first byte is acknowledged. */
function uploadingLabel(fraction: number): string {
  return fraction > 0 ? `Uploading… ${Math.round(fraction * 100)}%` : 'Uploading…';
}

/**
 * How far the upload has got.
 *
 * A spinner on a ten-megabyte upload over a phone connection says only that
 * something is happening; after fifteen seconds of it people press the button
 * again, which is how two copies of the same photograph end up on a listing.
 */
function ProgressBar({ fraction }: { fraction: number }) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
      style={{
        height: 4,
        borderRadius: 2,
        overflow: 'hidden',
        backgroundColor: rgb(theme.surfaceSunken),
      }}
    >
      <View
        style={{
          height: '100%',
          width: `${Math.max(4, Math.round(fraction * 100))}%`,
          backgroundColor: rgb(theme.brand),
        }}
      />
    </View>
  );
}

/**
 * The photographs already on the listing.
 *
 * A horizontal strip rather than a wrapping grid: a portfolio grows, and a grid
 * that grows downwards pushes the rest of the form off the screen every time a
 * photograph is added.
 */
export function MediaStrip({
  urls,
  onRemove,
}: {
  urls: string[];
  /** Absent makes the strip read-only, which is what a review screen wants. */
  onRemove?: (url: string) => void;
}) {
  const theme = useTheme();
  if (urls.length === 0) return null;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(2) }}>
      {urls.map((url) => (
        <View key={url}>
          <Image
            source={{ uri: url }}
            style={{ width: 116, height: 84, borderRadius: radius.sm, backgroundColor: rgb(theme.surfaceSunken) }}
            contentFit="cover"
            transition={150}
          />
          {onRemove && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove this photo"
              onPress={() => onRemove(url)}
              // Its own 32pt target in the corner rather than a text link
              // under the picture, which at this size would be wider than the
              // picture itself.
              style={({ pressed }) => [
                {
                  position: 'absolute',
                  top: space(1),
                  right: space(1),
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: rgba(theme.scrim, 0.6),
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <X size={14} weight="bold" color="#fff" />
            </Pressable>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

/** The stored file name, not the whole URL: a media path is not something anybody reads. */
export function documentName(url: string, index = 0): string {
  try {
    return decodeURIComponent(url.split('/').pop() ?? `Document ${index + 1}`);
  } catch {
    return `Document ${index + 1}`;
  }
}

/**
 * Compliance documents, as a list of openable rows.
 *
 * Opened in the system browser rather than in the app: these are PDFs and
 * photographs stored elsewhere, and an in-app viewer for them would be a viewer
 * to maintain for no benefit over the one the phone already has.
 */
export function DocumentList({
  urls,
  onRemove,
}: {
  urls: string[];
  onRemove?: (url: string) => void;
}) {
  const theme = useTheme();
  if (urls.length === 0) return null;

  return (
    <View
      style={{
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: rgb(theme.border),
        borderRadius: radius.sm,
        overflow: 'hidden',
      }}
    >
      {urls.map((url, i) => (
        <View
          key={url}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space(2),
            paddingHorizontal: space(3),
            paddingVertical: space(2),
            minHeight: 48,
            borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
            borderTopColor: rgb(theme.border),
          }}
        >
          <FileText size={18} color={rgb(theme.ink[400])} />
          <Pressable
            accessibilityRole="link"
            onPress={() => {
              void WebBrowser.openBrowserAsync(url).catch(() =>
                Alert.alert('That document could not be opened.'),
              );
            }}
            style={{ flex: 1, justifyContent: 'center', minHeight: 44 }}
          >
            <Body tone="brand" numberOfLines={1}>
              {documentName(url, i)}
            </Body>
          </Pressable>
          {onRemove && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${documentName(url, i)}`}
              onPress={() => onRemove(url)}
              style={({ pressed }) => [
                { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
                pressed && { opacity: 0.6 },
              ]}
            >
              <Trash size={17} color={rgb(theme.criticalFg)} />
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}
