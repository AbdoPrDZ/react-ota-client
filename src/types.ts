/**
 * Public type definitions shared by the imperative API, the hooks and the
 * React components. Every shape mirrors the JSON produced by the native
 * `OtaClient` module.
 */

/** Server coordinates used for every request the engine makes. */
export interface OtaServerConfig {
  /** Scheme + host, e.g. `https://updates.example.com`. No trailing slash needed. */
  apiBaseUrl: string;
  /** API prefix appended to `apiBaseUrl`, e.g. `v1`. */
  apiVersion: string;
  /** Sent as the `API-KEY` request header. */
  apiKey: string;
}

/** Partial config accepted by `OtaClient.configure()`; unset keys are left alone. */
export type OtaConfigInput = Partial<OtaServerConfig>;

export interface OtaDeviceInfo {
  androidId: string | null;
  manufacturer: string;
  brand: string;
  model: string;
  androidVersion: string;
  sdkVersion: number;
  supportedAbis: string[];
}

/** The `manifest.json` that travels inside every OTA archive. */
export interface OtaManifest {
  /** Bundle version published to the server. */
  version: string;
  /** Native runtime compatibility key; must match the host APK `versionName`. */
  runtimeVersion: string;
  /** File name of the bundle inside the archive. */
  bundle: string;
  /** MD5 of the bundle, verified after extraction. */
  checksum?: string | null;
  /** Byte size of the bundle, verified after extraction. */
  size?: number | null;
  createdAt?: string | null;
}

export type OtaBundleSource = 'downloaded' | 'embedded';

export interface OtaBundleInfo {
  manifest: OtaManifest;
  /** `downloaded` when a staged OTA bundle is active, `embedded` when the APK copy is used. */
  source: OtaBundleSource;
  /** Absolute path of the active bundle, `null` while the embedded copy is used. */
  path: string | null;
  /**
   * Absolute path of the directory holding the active bundle and its `fonts/` and
   * `assets/` folders, `null` while the embedded copy is used.
   *
   * Build `file://` URIs from this to reach images that ship with the bundle; see
   * `useBundleAssetUri`.
   */
  directory: string | null;
}

export interface OtaAppInfo {
  packageName: string;
  versionName: string;
  versionCode: number;
}

export interface OtaUpdateInfo {
  id: string;
  name: string;
  /**
   * `force` when the server requires this update — the client must install it
   * and may not offer a "not now". Defaults to `optional` when the server (or an
   * older server) omits the field.
   */
  updateType?: OtaUpdateType;
}

/** How insistently the server wants an update installed. */
export type OtaUpdateType = 'optional' | 'force';

export interface OtaAvailableUpdates {
  /** A new APK is available. */
  version: OtaUpdateInfo | null;
  /** A new JS bundle is available. */
  bundle: OtaUpdateInfo | null;
}

export interface OtaRemoteAppInfo {
  appId: string;
  versionId: string;
  bundleId: string;
  availableUpdates: OtaAvailableUpdates;
  /** Short-lived token required to download bundles. */
  session: string;
}

export interface OtaCheckUpdateResult {
  haveUpdate: boolean;
  haveVersionUpdate: boolean;
  haveBundleUpdate: boolean;
  appInfo: OtaRemoteAppInfo | null;
}

export interface OtaDownloadProgress {
  /** Bytes written to disk so far. */
  downloaded: number;
  /** Total bytes, `null` when the server omits `Content-Length`. */
  total: number | null;
  /** 0-100, `null` when the total size is unknown. */
  percent: number | null;
}

export interface OtaDownloadResult {
  /** Staging directory the archive was expanded into. */
  downloadDir: string;
  manifest: OtaManifest;
  fileName: string;
  size: number | null;
  checksum: string | null;
}

export interface OtaState {
  platform: string;
  /** Version of this library, useful when reporting bugs. */
  libraryVersion: string;
  /** `true` once an API base URL is known (from the manifest or from JS). */
  configured: boolean;
  config: OtaServerConfig;
  deviceInfo: OtaDeviceInfo | null;
  app: OtaAppInfo;
  bundle: OtaBundleInfo;
  /** `false` when the active bundle was built for a different native runtime. */
  runtimeCompatible: boolean;
  /** `true` while an installed bundle has not been confirmed by a successful launch yet. */
  pendingLaunch: boolean;
  /** `true` when the engine is standing down so Metro can serve the bundle. */
  usingDevServer: boolean;
}

export type OtaStatus =
  /** Reading native state / applying configuration. */
  | 'initializing'
  /** No API base URL known yet — render `OTAConfigureScreen`. */
  | 'unconfigured'
  /** `healthCheck()` in flight. */
  | 'checking'
  /** The update check found nothing to install. */
  | 'ready'
  /** The update check found a bundle and/or a new APK. */
  | 'update-available'
  /** A bundle is being downloaded. */
  | 'downloading'
  /** The last operation failed; `OtaState.error` explains it. */
  | 'failed';

export interface OtaStatusSnapshot {
  status: OtaStatus;
  native: OtaState | null;
  check: OtaCheckUpdateResult | null;
  progress: OtaDownloadProgress | null;
  error: Error | null;
}

export type OtaDownloadListener = (progress: OtaDownloadProgress) => void;

/** Events the engine reports to the server for activity logging. */
export type OtaReportEvent =
  | 'update.available'
  | 'update.refused'
  | 'update.downloaded'
  | 'update.installed'
  | 'update.failed'
  | 'update.rollback'
  | 'bundle.launch_confirmed'
  | 'bundle.launch_failed';

/** Free-form, JSON-serialisable metadata attached to a reported event. */
export type OtaReportPayload = Record<
  string,
  string | number | boolean | null | undefined
>;
