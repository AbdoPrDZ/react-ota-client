import {
  getEmitter,
  isNativeAvailable,
  OTA_EVENTS,
  requireNative,
  unwrap,
} from './internal/nativeModule';
import {
  OtaBundleInfo,
  OtaCheckUpdateResult,
  OtaConfigInput,
  OtaDeviceInfo,
  OtaDownloadListener,
  OtaDownloadProgress,
  OtaDownloadResult,
  OtaServerConfig,
  OtaState,
} from './types';

export interface DownloadOptions {
  /**
   * Download a specific bundle update instead of the one discovered by the last
   * `checkUpdate()` call. Only needed for advanced / queued flows.
   */
  updateId?: string;
  /** Session token matching `updateId`; defaults to the cached check result. */
  session?: string;
}

export interface InstallOptions {
  /** Staging directory to activate. Defaults to the last download. */
  directory?: string | null;
  /** Set to `false` to activate the bundle without restarting the app. */
  restart?: boolean;
}

export interface OpenAppUpdateOptions {
  /** Skip the network round trip and open this URL directly. */
  url?: string;
}

/**
 * Imperative facade over the Kotlin update engine.
 *
 * Every method rejects with a real `Error`; nothing throws synchronously except
 * `isSupported()`, which is a pure environment probe.
 */
export const OtaClient = {
  /** `true` on Android with the native module linked. */
  isSupported(): boolean {
    return isNativeAvailable();
  },

  /**
   * Persists the server coordinates. Unset keys keep their current value, so
   * `configure({ apiKey })` only changes the key.
   */
  async configure(config: OtaConfigInput): Promise<OtaServerConfig> {
    return unwrap(requireNative().configure(config));
  },

  /** Current server coordinates (JS values, falling back to manifest meta-data). */
  async getConfig(): Promise<OtaServerConfig> {
    return unwrap(requireNative().getConfig());
  },

  /** Full snapshot: app info, active bundle, runtime compatibility, device info. */
  async getState(): Promise<OtaState> {
    return unwrap(requireNative().getState());
  },

  /** Device fingerprint sent in the `X-Device-Info` header. */
  async getDeviceInfo(): Promise<OtaDeviceInfo> {
    return unwrap(requireNative().getDeviceInfo());
  },

  /** `GET {base}/ota-client/{version}/health`; resolves `false` instead of throwing. */
  async healthCheck(): Promise<boolean> {
    return unwrap(requireNative().healthCheck());
  },

  /**
   * `POST .../app/info` for the host package/version/bundle triple.
   * The result is cached natively so `downloadBundle()` can reuse the session.
   */
  async checkUpdate(): Promise<OtaCheckUpdateResult> {
    return unwrap(requireNative().checkUpdate());
  },

  /**
   * Downloads, verifies and stages the newest bundle.
   * Resolves once the archive is on disk; nothing is activated yet.
   */
  async downloadBundle(options: DownloadOptions = {}): Promise<OtaDownloadResult> {
    return unwrap(requireNative().downloadBundle(options));
  },

  /**
   * Stages the bundle, marks the current one as "last known good" and restarts
   * the app. After the restart the new bundle is served by
   * `OtaBundleProvider.getJSBundleFile()`.
   */
  async installBundle(options: InstallOptions = {}): Promise<void> {
    const native = requireNative();

    if (options.restart === false) {
      await unwrap(native.activateBundle(options.directory ?? null));
      return;
    }

    if (options.directory) {
      await unwrap(native.activateBundle(options.directory));
    }

    return unwrap(native.installBundle(options.directory ?? null));
  },

  /** `downloadBundle()` + `installBundle()` in one call. */
  async downloadAndInstall(
    options: DownloadOptions & InstallOptions = {},
  ): Promise<OtaDownloadResult> {
    const result = await this.downloadBundle(options);

    await this.installBundle({ directory: result.downloadDir, restart: options.restart });

    return result;
  },

  /**
   * Tells the engine the current bundle booted successfully. Without this the
   * next launch reverts automatically, which is what makes a bad OTA recoverable.
   */
  async markLaunchSucceeded(): Promise<void> {
    return unwrap(requireNative().markLaunchSucceeded());
  },

  /** Goes back to the bundle embedded in the APK. Resolves `true` when a change happened. */
  async revertToEmbeddedBundle(): Promise<boolean> {
    return unwrap(requireNative().revertToEmbeddedBundle());
  },

  /** Deletes stale staging directories, keeping the `keep` newest. Resolves the number deleted. */
  async cleanupOldBundles(keep = 2): Promise<number> {
    return unwrap(requireNative().cleanupOldBundles(keep));
  },

  /** Describes the bundle that is active right now. */
  async getBundleInfo(): Promise<OtaBundleInfo> {
    const state = await this.getState();
    return state.bundle;
  },

  /**
   * APK download URL for a pending app-version update, signed with the session
   * token and the device id. Rejects with `E_OTA_NO_VERSION_UPDATE` when the
   * last `checkUpdate()` did not report a new version.
   */
  async getAppUpdateUrl(): Promise<string> {
    return unwrap(requireNative().getAppUpdateUrl());
  },

  /** Opens the APK download URL with `ACTION_VIEW` (browser / package installer). */
  async openAppUpdate(options: OpenAppUpdateOptions = {}): Promise<boolean> {
    const url = options.url ?? (await this.getAppUpdateUrl());
    return unwrap(requireNative().openAppUpdate(url));
  },

  /** Relaunches the launcher activity and kills the current process. */
  async restartApp(): Promise<void> {
    return unwrap(requireNative().restartApp());
  },

  /**
   * Subscribes to native download progress.
   * Returns an unsubscribe function; safe to call when the engine is absent.
   */
  addDownloadProgressListener(listener: OtaDownloadListener): () => void {
    const emitter = getEmitter();
    const subscription = emitter?.addListener(OTA_EVENTS.progress, (payload: unknown) => {
      const event = payload as OtaDownloadProgress | undefined;

      if (event && typeof event.downloaded === 'number') {
        listener(event);
      }
    });

    return () => subscription?.remove();
  },

  /** Subscribes to asynchronous engine errors that have no owning promise. */
  addErrorListener(listener: (error: Error) => void): () => void {
    const emitter = getEmitter();
    const subscription = emitter?.addListener(OTA_EVENTS.error, (payload: unknown) => {
      const event = payload as { message?: string } | undefined;
      listener(new Error(event?.message ?? 'Unknown ota-client error'));
    });

    return () => subscription?.remove();
  },
};

export type OtaClientApi = typeof OtaClient;
