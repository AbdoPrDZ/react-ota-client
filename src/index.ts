/**
 * ota-client — over-the-air JavaScript bundle updates for React Native (Android).
 *
 * Three ways in, from most to least automatic:
 *
 * ```tsx
 * // 1. Declarative: wrap your root.
 * <OTAProvider config={{ apiBaseUrl, apiKey }}><App /></OTAProvider>
 *
 * // 2. Hooks: keep your own UI.
 * const { status, check, progress, downloadAndInstall } = useOTA();
 *
 * // 3. Imperative: no React at all.
 * await OtaClient.checkUpdate();
 * await OtaClient.downloadAndInstall();
 * ```
 */
import { OtaClient } from './OtaClient';

export { OtaClient } from './OtaClient';
export type {
  DownloadOptions,
  InstallOptions,
  OtaClientApi,
  OpenAppUpdateOptions,
} from './OtaClient';

export { useOTA, useOTABundleInfo, useOtaNativeState } from './hooks/useOTA';

export { OtaContext, useOtaContext, useOptionalOtaContext } from './context';
export type { OtaActions, OtaContextValue, OtaServerConfigSnapshot } from './context';

export { OTAProvider } from './components/OTAProvider';
export type { OTAProviderProps } from './components/OTAProvider';

export {
  OTAUpdateOverlay,
} from './components/OTAUpdateOverlay';
export type {
  OTAUpdateOverlayCopy,
  OTAUpdateOverlayProps,
} from './components/OTAUpdateOverlay';

export {
  OTAConfigureModal,
  OTAConfigureScreen,
} from './components/OTAConfigureScreen';
export type {
  OTAConfigureModalProps,
  OTAConfigureScreenProps,
} from './components/OTAConfigureScreen';

export { OTASplashScreen } from './components/OTASplashScreen';
export type { OTASplashScreenProps } from './components/OTASplashScreen';

export {
  OtaLinkingError,
  OtaNotConfiguredError,
  OtaUnsupportedPlatformError,
} from './internal/errors';

export { isNativeAvailable, OTA_EVENTS } from './internal/nativeModule';
export type { UseOTAFlowOptions } from './internal/useOTAFlow';

export { otaColors, otaRadius, otaSpacing } from './styles';

export * from './types';

export default OtaClient;
