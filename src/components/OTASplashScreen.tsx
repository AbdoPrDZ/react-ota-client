import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { useOTABundleInfo } from '../hooks/useOTA';
import { otaColors, otaSpacing } from '../styles';

export interface OTASplashScreenProps {
  /** Rendered under the spinner. */
  message?: string;
  /** Shown as the big label. Defaults to the host app name from native. */
  title?: string;
  /** Appends `app vX · bundle Y` under the spinner. Default `true`. */
  showVersion?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
  messageStyle?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * Neutral loading screen for the boot phase. Use it as `OTAProvider`'s
 * `bootFallback` so the user sees your branding while native state is read.
 */
export function OTASplashScreen({
  message,
  title,
  showVersion = true,
  containerStyle,
  titleStyle,
  messageStyle,
  testID = 'ota-splash',
}: OTASplashScreenProps) {
  const bundle = useOTABundleInfo();

  const versionLine = showVersion
    ? [
        bundle ? `app v${bundle.manifest.runtimeVersion}` : null,
        bundle ? `bundle ${bundle.manifest.version}` : null,
        bundle?.source === 'downloaded' ? '(downloaded)' : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <View style={[styles.container, containerStyle]} testID={testID}>
      {title ? <Text style={[styles.title, titleStyle]}>{title}</Text> : null}
      <ActivityIndicator size="large" color={otaColors.primary} style={styles.spinner} />
      {message ? <Text style={[styles.message, messageStyle]}>{message}</Text> : null}
      {versionLine ? <Text style={[styles.message, messageStyle]}>{versionLine}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: otaSpacing.lg,
    backgroundColor: otaColors.background,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: otaColors.title,
    marginBottom: otaSpacing.md,
  },
  spinner: {
    marginBottom: otaSpacing.md,
  },
  message: {
    marginTop: otaSpacing.xs,
    fontSize: 14,
    color: otaColors.body,
    textAlign: 'center',
  },
});
