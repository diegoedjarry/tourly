// Native-feel capture sheet for the Zero-Click Expense Engine.
//
// Slides up from the bottom, dismisses on backdrop tap or downward swipe, and
// immediately hands off to the system camera / photo library / file picker.
// Emits raw base64 + media type; the caller runs parseReceipt() and decides
// between one-tap confirm and the pre-filled manual fallback.

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { Text } from '@/components/ui/text';
import { T } from '@/constants/theme';
import { useLanguage } from '@/hooks/useLanguage';
import { useAppAlert } from '@/components/ui/app-alert';
import type { ReceiptMediaType } from '@/utils/receipt';

// Server rejects payloads whose base64 exceeds 8_000_000 chars anyway — cap
// the raw file size well below that (~6MB) so we can reject client-side with
// a clear message instead of burning a network round-trip on a guaranteed
// rejection.
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_BASE64_CHARS = 8_000_000;

export interface CapturedReceipt {
  base64: string;
  mediaType: ReceiptMediaType;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called with the captured file. The sheet closes itself first. */
  onCaptured: (file: CapturedReceipt) => void;
}

const IMAGE_OPTS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  base64: true,
  quality: 0.6, // receipts are text — 0.6 keeps them readable at ~10x smaller
  allowsEditing: false,
};

function mediaTypeFromUri(uri: string, fallback: ReceiptMediaType = 'image/jpeg'): ReceiptMediaType {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return fallback;
}

export function ReceiptCaptureSheet({ visible, onClose, onCaptured }: Props) {
  const { t } = useLanguage();
  const { show: showAlert } = useAppAlert();
  const slide = useRef(new Animated.Value(300)).current;
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      slide.setValue(300);
      Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
    }
  }, [visible, slide]);

  const dismiss = () => {
    Animated.timing(slide, { toValue: 300, duration: 200, useNativeDriver: true }).start(onClose);
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => gs.dy > 8,
      onPanResponderMove: (_, gs) => { if (gs.dy > 0) slide.setValue(gs.dy); },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 60) dismiss();
        else Animated.spring(slide, { toValue: 0, useNativeDriver: true }).start();
      },
    }),
  ).current;

  async function handoff(file: CapturedReceipt) {
    onClose();
    onCaptured(file);
  }

  async function takePhoto() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBusy('camera');
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return;
      const result = await ImagePicker.launchCameraAsync(IMAGE_OPTS);
      const asset = result.assets?.[0];
      if (result.canceled || !asset?.base64) return;
      await handoff({ base64: asset.base64, mediaType: asset.mimeType === 'image/png' ? 'image/png' : 'image/jpeg' });
    } finally { setBusy(null); }
  }

  async function pickFromLibrary() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBusy('library');
    try {
      const result = await ImagePicker.launchImageLibraryAsync(IMAGE_OPTS);
      const asset = result.assets?.[0];
      if (result.canceled || !asset?.base64) return;
      await handoff({ base64: asset.base64, mediaType: asset.mimeType === 'image/png' ? 'image/png' : 'image/jpeg' });
    } finally { setBusy(null); }
  }

  async function pickFile() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBusy('file');
    try {
      let DocumentPicker;
      try {
        DocumentPicker = await import('expo-document-picker');
      } catch {
        // Native module missing (e.g. binary/JS version drift after an OTA update) —
        // fail quietly instead of crashing the whole app.
        return;
      }
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
        copyToCacheDirectory: true,
      });
      const asset = result.assets?.[0];
      if (result.canceled || !asset?.uri) return;
      if (typeof asset.size === 'number' && asset.size > MAX_FILE_BYTES) {
        showAlert(t('common.error'), t('receipt.fileTooLarge'));
        return;
      }
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      if (base64.length > MAX_BASE64_CHARS) {
        showAlert(t('common.error'), t('receipt.fileTooLarge'));
        return;
      }
      const mediaType = (asset.mimeType as ReceiptMediaType) ?? mediaTypeFromUri(asset.uri);
      await handoff({ base64, mediaType });
    } finally { setBusy(null); }
  }

  if (!visible) return null;

  const options = [
    { key: 'camera',  icon: '📸', label: t('receipt.takePhoto'),  onPress: takePhoto },
    { key: 'library', icon: '🖼️', label: t('receipt.fromLibrary'), onPress: pickFromLibrary },
    { key: 'file',    icon: '📄', label: t('receipt.fromFile'),    onPress: pickFile },
  ];

  return (
    <Modal transparent animationType="fade" onRequestClose={dismiss} statusBarTranslucent>
      <Pressable style={s.backdrop} onPress={dismiss}>
        <Animated.View style={[s.sheet, { transform: [{ translateY: slide }] }]}>
          <Pressable onPress={() => {}}>
            <View style={s.handleArea} {...pan.panHandlers}>
              <View style={s.handle} />
            </View>
            <Text style={s.title}>{t('receipt.scanTitle')}</Text>
            <Text style={s.subtitle}>{t('receipt.scanSubtitle')}</Text>
            {options.map((o) => (
              <TouchableOpacity
                key={o.key}
                style={s.option}
                onPress={o.onPress}
                disabled={busy !== null}
                activeOpacity={0.75}
              >
                <Text style={s.optionIcon}>{o.icon}</Text>
                <Text style={s.optionLabel}>{o.label}</Text>
                {busy === o.key && <ActivityIndicator size="small" color={T.teal} />}
              </TouchableOpacity>
            ))}
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(4, 8, 20, 0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: T.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderColor: T.cardBorder,
  },
  handleArea: { alignItems: 'center', paddingVertical: 10 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: T.textMuted },
  title: { fontSize: 17, fontWeight: '700', color: T.textPrimary, textAlign: 'center' },
  subtitle: { fontSize: 13, color: T.textSecondary, textAlign: 'center', marginTop: 4, marginBottom: 16 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: T.cardElevated,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: T.cardBorder,
  },
  optionIcon: { fontSize: 20 },
  optionLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: T.textPrimary },
});
