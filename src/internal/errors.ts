const LINKING_ERROR =
  "The native module of 'ota-client' is not available.\n" +
  '- Rebuild the Android app after installing the package (`npx react-native run-android`).\n' +
  '- Make sure autolinking picked it up: `npx react-native config` should list `ota-client`.\n' +
  '- If you use a custom `react-native.config.js`, add the package to `packageImportPath` manually.';

/** Thrown when a JS-only platform (iOS, web) calls into the Android engine. */
export class OtaUnsupportedPlatformError extends Error {
  readonly code = 'E_OTA_UNSUPPORTED_PLATFORM';

  constructor(platform: string) {
    super(
      `ota-client only supports Android; cannot run on "${platform}". ` +
        'The update engine is implemented in Kotlin and has no iOS implementation.',
    );
    this.name = 'OtaUnsupportedPlatformError';
  }
}

/** Thrown when the native module is missing from the build. */
export class OtaLinkingError extends Error {
  readonly code = 'E_OTA_LINKING';

  constructor() {
    super(LINKING_ERROR);
    this.name = 'OtaLinkingError';
  }
}

/** Thrown when the host app has no API base URL configured yet. */
export class OtaNotConfiguredError extends Error {
  readonly code = 'E_OTA_NOT_CONFIGURED';

  constructor() {
    super(
      'ota-client is not configured: no API base URL. Pass one to `configure()` or add ' +
        '`<meta-data android:name="ota_client_api_base_url" .../>` to the host AndroidManifest.xml.',
    );
    this.name = 'OtaNotConfiguredError';
  }
}

/** Normalises anything thrown by the bridge into a real `Error`. */
export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  if (typeof value === 'string') {
    return new Error(value);
  }

  if (value && typeof value === 'object') {
    const record = value as { message?: unknown; code?: unknown };

    if (typeof record.message === 'string') {
      const error = new Error(record.message);

      if (typeof record.code === 'string') {
        error.name = record.code;
      }

      return error;
    }
  }

  return new Error(String(value));
}
