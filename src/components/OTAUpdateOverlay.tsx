import { useMemo, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { useOtaContext } from '../context';
import { otaColors, otaRadius, otaSpacing } from '../styles';
import type { OtaCheckUpdateResult, OtaStatus } from '../types';

export interface OTAUpdateOverlayCopy {
  updateTitle: string;
  updateMessage: string;
  appUpdateMessage: string;
  installLabel: string;
  laterLabel: string;
  downloadVersionLabel: string;
  downloadingLabel: string;
  restartingLabel: string;
  retryLabel: string;
  unknownSizeLabel: string;
}

export interface OTAUpdateOverlayProps {
  /** Force the overlay open/closed. Defaults to the provider's own status. */
  visible?: boolean;
  /** Show the "not now" escape hatch. Default `true`. */
  allowLater?: boolean;
  /** Offer the APK download when the server reports a new app version. Default `true`. */
  showAppVersionUpdate?: boolean;
  copy?: Partial<OTAUpdateOverlayCopy>;
  /** Escape hatch: render your own UI and drive the actions yourself. */
  render?: (state: {
    status: OtaStatus;
    check: OtaCheckUpdateResult | null;
    error: Error | null;
    progress: { percent: number | null; downloaded: number; total: number | null } | null;
    install(): void;
    installVersion(): void;
    later(): void;
    retry(): void;
  }) => ReactNode;
  overlayStyle?: StyleProp<ViewStyle>;
  cardStyle?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
  messageStyle?: StyleProp<TextStyle>;
  primaryButtonStyle?: StyleProp<ViewStyle>;
  secondaryButtonStyle?: StyleProp<ViewStyle>;
  progressTrackStyle?: StyleProp<ViewStyle>;
  progressFillStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

const defaultCopy: OTAUpdateOverlayCopy = {
  updateTitle: 'Update available',
  updateMessage: 'A new version is ready to download.',
  appUpdateMessage: 'A new app version is available.',
  installLabel: 'Install now',
  laterLabel: 'Not now',
  downloadVersionLabel: 'Download new version',
  downloadingLabel: 'Downloading update',
  restartingLabel: 'Installing update',
  retryLabel: 'Retry',
  unknownSizeLabel: 'Downloading update',
};

/**
 * Blocking update UI: prompt, determinate/indeterminate download progress, and
 * the failure state. Rendered automatically by `OTAProvider`; render it yourself
 * only if you manage the flow imperatively.
 */
export function OTAUpdateOverlay({
  visible,
  allowLater = true,
  showAppVersionUpdate = true,
  copy,
  render,
  overlayStyle,
  cardStyle,
  titleStyle,
  messageStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  progressTrackStyle,
  progressFillStyle,
  testID = 'ota-update-overlay',
}: OTAUpdateOverlayProps) {
  const { status, check, progress, error, dismissed, downloadAndInstall, openAppUpdate, dismissUpdate, retry } =
    useOtaContext();

  const texts = useMemo(() => ({ ...defaultCopy, ...copy }), [copy]);

  const isVisible =
    (visible ?? (status === 'update-available' || status === 'downloading' || status === 'failed')) &&
    !dismissed;

  if (!isVisible) {
    return null;
  }

  const installing = status === 'downloading';
  const failed = status === 'failed' && error;
  const bundleUpdate = check?.haveBundleUpdate ?? false;
  const versionUpdate = showAppVersionUpdate && (check?.haveVersionUpdate ?? false);

  if (render) {
    return (
      <Modal transparent animationType="fade" visible statusBarTranslucent onRequestClose={dismissUpdate}>
        <View style={[styles.overlay, overlayStyle]}>
          {render({
            status,
            check,
            error,
            progress: progress
              ? { percent: progress.percent, downloaded: progress.downloaded, total: progress.total }
              : null,
            install: () => {
              void downloadAndInstall();
            },
            installVersion: () => {
              void openAppUpdate();
            },
            later: dismissUpdate,
            retry,
          })}
        </View>
      </Modal>
    );
  }

  const progressPercent = progress?.percent ?? null;

  const title = failed
    ? 'Update failed'
    : installing
      ? texts.restartingLabel
      : texts.updateTitle;

  const body = failed
    ? error.message
    : installing
      ? progressPercent == null
        ? texts.unknownSizeLabel
        : `${texts.downloadingLabel}… ${progressPercent}%`
      : [versionUpdate ? texts.appUpdateMessage : null, bundleUpdate ? texts.updateMessage : null]
          .filter(Boolean)
          .join('\n\n');

  return (
    <Modal
      transparent
      animationType="fade"
      visible
      statusBarTranslucent
      onRequestClose={allowLater ? dismissUpdate : () => {}}
    >
      <View style={[styles.overlay, overlayStyle]} testID={testID}>
        <View style={[styles.card, cardStyle]}>
          <Text style={[styles.title, titleStyle]}>{title}</Text>
          <Text style={[styles.message, messageStyle]}>{body}</Text>

          {installing ? (
            progressPercent == null ? (
              <ActivityIndicator style={styles.indeterminate} color={otaColors.primary} />
            ) : (
              <View
                style={[styles.progressTrack, progressTrackStyle]}
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: 100, now: progressPercent }}
              >
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.min(100, Math.max(0, progressPercent))}%` },
                    progressFillStyle,
                  ]}
                />
              </View>
            )
          ) : null}

          {failed ? (
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                onPress={retry}
                style={({ pressed }) => [
                  styles.primaryButton,
                  primaryButtonStyle,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.primaryLabel}>{texts.retryLabel}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.actions}>
              {versionUpdate ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    void openAppUpdate();
                  }}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    primaryButtonStyle,
                    pressed && styles.pressed,
                  ]}
                  testID={`${testID}-download-version`}
                >
                  <Text style={styles.primaryLabel}>{texts.downloadVersionLabel}</Text>
                </Pressable>
              ) : null}

              {bundleUpdate ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    void downloadAndInstall();
                  }}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    primaryButtonStyle,
                    pressed && styles.pressed,
                  ]}
                  testID={`${testID}-install`}
                >
                  <Text style={styles.primaryLabel}>{texts.installLabel}</Text>
                </Pressable>
              ) : null}

              {allowLater ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={dismissUpdate}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    secondaryButtonStyle,
                    pressed && styles.pressed,
                  ]}
                  testID={`${testID}-later`}
                >
                  <Text style={styles.secondaryLabel}>{texts.laterLabel}</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: otaSpacing.lg,
    backgroundColor: otaColors.overlay,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: otaRadius.lg,
    backgroundColor: otaColors.card,
    padding: otaSpacing.lg,
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    color: otaColors.title,
    marginBottom: otaSpacing.sm,
  },
  message: {
    fontSize: 15,
    lineHeight: 21,
    color: otaColors.body,
    marginBottom: otaSpacing.lg,
  },
  indeterminate: {
    marginBottom: otaSpacing.lg,
  },
  progressTrack: {
    height: 6,
    borderRadius: otaRadius.pill,
    backgroundColor: otaColors.track,
    overflow: 'hidden',
    marginBottom: otaSpacing.lg,
  },
  progressFill: {
    height: '100%',
    borderRadius: otaRadius.pill,
    backgroundColor: otaColors.primary,
  },
  actions: {
    gap: otaSpacing.sm,
  },
  primaryButton: {
    height: 46,
    borderRadius: otaRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: otaColors.primary,
    paddingHorizontal: otaSpacing.md,
  },
  primaryLabel: {
    color: otaColors.primaryText,
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryButton: {
    height: 46,
    borderRadius: otaRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: otaColors.secondary,
    paddingHorizontal: otaSpacing.md,
  },
  secondaryLabel: {
    color: otaColors.secondaryText,
    fontSize: 15,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.85,
  },
});
