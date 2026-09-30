import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

import {
  OtaBundleInfo,
  OtaCheckUpdateResult,
  OtaConfigInput,
  OtaDeviceInfo,
  OtaDownloadResult,
  OtaServerConfig,
  OtaState,
} from '../types';
import {
  OtaLinkingError,
  OtaUnsupportedPlatformError,
  toError,
} from './errors';

/** Event names emitted by the native module. */
export const OTA_EVENTS = {
  progress: 'otaClient:downloadProgress',
  error: 'otaClient:error',
} as const;

/**
 * The raw bridge surface. Kept private so the rest of the library always goes
 * through `OtaClient` and never has to think about missing native code.
 */
interface OtaNativeModule {
  getState(): Promise<OtaState>;
  configure(config: OtaConfigInput): Promise<OtaServerConfig>;
  getConfig(): Promise<OtaServerConfig>;
  getDeviceInfo(): Promise<OtaDeviceInfo>;
  healthCheck(): Promise<boolean>;
  checkUpdate(): Promise<OtaCheckUpdateResult>;
  downloadBundle(options?: { updateId?: string; session?: string }): Promise<OtaDownloadResult>;
  activateBundle(directory?: string | null): Promise<OtaBundleInfo>;
  installBundle(directory?: string | null): Promise<void>;
  markLaunchSucceeded(): Promise<void>;
  revertToEmbeddedBundle(): Promise<boolean>;
  cleanupOldBundles(keep: number): Promise<number>;
  getAppUpdateUrl(): Promise<string>;
  openAppUpdate(url: string): Promise<boolean>;
  restartApp(): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const native: OtaNativeModule | undefined = (
  Platform.OS === 'android' ? NativeModules.OtaClient : undefined
) as OtaNativeModule | undefined;

/** `true` when the Android engine is linked into the running build. */
export const isNativeAvailable = (): boolean => native != null;

/** Throws the right error for the current platform / build. */
export function requireNative(): OtaNativeModule {
  if (Platform.OS !== 'android') {
    throw new OtaUnsupportedPlatformError(Platform.OS);
  }

  if (!native) {
    throw new OtaLinkingError();
  }

  return native;
}

let emitter: NativeEventEmitter | null = null;

/** Lazily built event emitter; `null` when the native module is absent. */
export function getEmitter(): NativeEventEmitter | null {
  if (!native) {
    return null;
  }

  if (!emitter) {
    emitter = new NativeEventEmitter(native as unknown as never);
  }

  return emitter;
}

/**
 * Rejects with a normalised `Error` when the native call failed.
 * The bridge rejects with plain objects (`{ code, message }`).
 */
export function unwrap<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((error: unknown) => {
    throw toError(error);
  });
}
