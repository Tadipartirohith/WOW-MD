import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { FileText, Trash, X } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { Body, Button, Caption } from '@/components/ui';
import { radius, rgb, rgba, space, useTheme } from '@/theme';

/**
 * Picking a photograph and putting it where the platform serves it from.
 *
 * The same two steps the web uploader takes — ask the API to presign, then PUT
 * the bytes straight at storage — because the reason for it is the same on both:
 * a fifty-megabyte upload must not occupy a request worker for the length of
 * somebody's phone connection.
 *
 * What is different is where the file comes from, and it is the whole point of
 * this screen existing. A vendor photographing their own venue is holding the
 * camera; the web form asked for a URL, which is why listings had no
 * photographs on them. Here the library and the camera are both one press away.
 */

/** Kept in step with `UPLOAD_IMAGE_EXTENSIONS` on the API. */
const FALLBACK_EXTENSION = 'jpg';

const MAX_BYTES = 10 * 1024 * 1024;

async function upload(uri: string, fileName: string, mimeType: string, kind: Kind) {
  const { data } = await api.post(
    kind === 'attachment' ? '/media/attachment/presign' : '/media/profile-photo/presign',
    { filename: fileName },
  );

  // `fetch` on a local file URI is how a React Native app reads its own file
  // into a body; there is no File object here to hand to the request.
  const file = await fetch(uri);
  const blob = await file.blob();
  if (blob.size > MAX_BYTES) {
    throw new Error('That photo is over 10MB. Choose a smaller one.');
  }

  const response = await fetch(data.uploadUrl, {
    method: 'PUT',
    body: blob,
    headers: { 'Content-Type': mimeType },
  });
  if (!response.ok) throw new Error(`Storage returned ${response.status}`);

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
  const [error, setError] = useState('');

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
    try {
      const name =
        asset.fileName ?? `upload-${Date.now()}.${asset.uri.split('.').pop() ?? FALLBACK_EXTENSION}`;
      const url = await upload(asset.uri, name, asset.mimeType ?? 'image/jpeg', kind);
      onUploaded(url);
    } catch (err) {
      setError(
        err instanceof Error && err.message.startsWith('That photo')
          ? err.message
          : apiMessage(err, 'That photo could not be uploaded.'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space(2) }}>
      <View style={{ flexDirection: 'row', gap: space(2) }}>
        <Button
          label={busy ? 'Uploading…' : label}
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
      {error ? <Caption tone="critical">{error}</Caption> : null}
      {kind === 'attachment' ? (
        <Caption tone="faint">
          A photograph of the document is fine — the officer checks what it says, not what it was
          scanned on. PDFs can be attached from the web app.
        </Caption>
      ) : null}
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
