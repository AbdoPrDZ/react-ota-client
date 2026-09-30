import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { OtaClient } from '../OtaClient';
import { otaColors, otaRadius, otaSpacing } from '../styles';
import type { OtaConfigInput } from '../types';

/**
 * Fallback server setup form, shown when no API base URL is known.
 *
 * Replaces the placeholder screen the old native `ConfigureActivity` never
 * implemented — everything here is plain React Native, so it is themeable and
 * testable. Values are written to the same native store the engine reads.
 */
export interface OTAConfigureScreenProps {
  /** Called after a successful save; the provider re-runs the update check. */
  onConfigured?: (config: OtaServerConfigLike) => void;
  /** Initial field values. Defaults to whatever native already has. */
  initialValues?: OtaConfigInput;
  title?: string;
  description?: string;
  submitLabel?: string;
  /** Hide the API key field (e.g. when the server does not need one). */
  hideApiKey?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  errorTextStyle?: StyleProp<TextStyle>;
  testID?: string;
}

type OtaServerConfigLike = OtaConfigInput;

const PLACEHOLDER_BASE_URL = 'https://updates.example.com';

export function OTAConfigureScreen({
  onConfigured,
  initialValues,
  title = 'Update server',
  description = 'Point this app at your OTA server to receive bundle updates.',
  submitLabel = 'Save',
  hideApiKey = false,
  containerStyle,
  contentStyle,
  inputStyle,
  errorTextStyle,
  testID = 'ota-configure',
}: OTAConfigureScreenProps) {
  const [apiBaseUrl, setApiBaseUrl] = useState(initialValues?.apiBaseUrl ?? '');
  const [apiVersion, setApiVersion] = useState(initialValues?.apiVersion ?? 'v1');
  const [apiKey, setApiKey] = useState(initialValues?.apiKey ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => apiBaseUrl.trim().length > 0 && !saving,
    [apiBaseUrl, saving],
  );

  const handleSave = useCallback(async () => {
    setError(null);
    setSaving(true);

    const config: OtaConfigInput = {
      apiBaseUrl: apiBaseUrl.trim().replace(/\/+$/, ''),
      apiVersion: apiVersion.trim().replace(/^\/+|\/+$/g, '') || 'v1',
      ...(hideApiKey ? {} : { apiKey: apiKey.trim() }),
    };

    try {
      const saved = await OtaClient.configure(config);
      onConfigured?.(saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }, [apiBaseUrl, apiKey, apiVersion, hideApiKey, onConfigured]);

  return (
    <View style={[styles.container, containerStyle]} testID={testID}>
      <View style={[styles.card, contentStyle]}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>

        <Text style={styles.label}>API base URL</Text>
        <TextInput
          style={[styles.input, inputStyle]}
          value={apiBaseUrl}
          onChangeText={setApiBaseUrl}
          placeholder={PLACEHOLDER_BASE_URL}
          placeholderTextColor={otaColors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="next"
          testID={`${testID}-base-url`}
        />

        <Text style={styles.label}>API version</Text>
        <TextInput
          style={[styles.input, inputStyle]}
          value={apiVersion}
          onChangeText={setApiVersion}
          placeholder="v1"
          placeholderTextColor={otaColors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          testID={`${testID}-api-version`}
        />

        {hideApiKey ? null : (
          <>
            <Text style={styles.label}>API key</Text>
            <TextInput
              style={[styles.input, inputStyle]}
              value={apiKey}
              onChangeText={setApiKey}
              placeholder="v1.xxxxxxxxxxxxxx"
              placeholderTextColor={otaColors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={canSubmit ? handleSave : undefined}
              testID={`${testID}-api-key`}
            />
          </>
        )}

        {error ? <Text style={[styles.error, errorTextStyle]}>{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit, busy: saving }}
          disabled={!canSubmit}
          onPress={handleSave}
          style={({ pressed }) => [
            styles.submit,
            !canSubmit && styles.submitDisabled,
            pressed && styles.submitPressed,
          ]}
          testID={`${testID}-submit`}
        >
          {saving ? (
            <ActivityIndicator color={otaColors.primaryText} />
          ) : (
            <Text style={styles.submitLabel}>{submitLabel}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The same form as a modal, for apps that want to fix the config without
 * replacing their whole screen.
 */
export interface OTAConfigureModalProps extends OTAConfigureScreenProps {
  visible: boolean;
  onClose?: () => void;
}

export function OTAConfigureModal({ visible, onClose, ...screenProps }: OTAConfigureModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <OTAConfigureScreen
            containerStyle={styles.modalScreenContainer}
            contentStyle={styles.modalScreenContent}
            {...screenProps}
          />
          {onClose ? (
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.modalClose}>
              <Text style={styles.modalCloseLabel}>Cancel</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
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
  card: {
    width: '100%',
    maxWidth: 480,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: otaColors.title,
    marginBottom: otaSpacing.xs,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    color: otaColors.body,
    marginBottom: otaSpacing.lg,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: otaColors.body,
    marginBottom: otaSpacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderColor: otaColors.secondary,
    borderRadius: otaRadius.sm,
    paddingHorizontal: otaSpacing.md,
    paddingVertical: otaSpacing.sm + 2,
    fontSize: 15,
    color: otaColors.title,
    marginBottom: otaSpacing.md,
    backgroundColor: otaColors.background,
  },
  error: {
    fontSize: 13,
    color: otaColors.danger,
    marginBottom: otaSpacing.md,
  },
  submit: {
    height: 48,
    borderRadius: otaRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: otaColors.primary,
  },
  submitDisabled: {
    opacity: 0.5,
  },
  submitPressed: {
    opacity: 0.85,
  },
  submitLabel: {
    color: otaColors.primaryText,
    fontSize: 16,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: otaColors.overlay,
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: otaColors.card,
    borderTopLeftRadius: otaRadius.lg,
    borderTopRightRadius: otaRadius.lg,
    paddingBottom: otaSpacing.lg,
  },
  modalScreenContainer: {
    backgroundColor: 'transparent',
    paddingHorizontal: otaSpacing.lg,
    paddingTop: otaSpacing.lg,
  },
  modalScreenContent: {
    maxWidth: undefined,
  },
  modalClose: {
    alignItems: 'center',
    paddingVertical: otaSpacing.md,
  },
  modalCloseLabel: {
    color: otaColors.body,
    fontSize: 15,
    fontWeight: '600',
  },
});
