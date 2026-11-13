# Native Updates

When the runtime changes, a bundle can't help: the user needs a new APK.
OTACenter offers it as `availableUpdates.version` from `/app/info`.

## In-app install (since 1.5.0)

Ported from OTAStore's `ApkInstaller`, like `expo-ota-client`'s module.
`com.otaclient.ota.ApkInstaller`:

- Downloads with `HttpURLConnection` (manual redirects, progress via the
  `otaClient:apkProgress` event, cancel), checks the SHA-256 against
  `version.checksum` and the "PK" magic bytes, then opens the system installer
  through `OtaApkFileProvider` (authority `${applicationId}.otaclient.apkprovider`,
  paths in `res/xml/ota_client_apk_paths.xml`).
- "Install unknown apps": `canInstallAppUpdate()`, `openInstallSettings()`
  (`canRequestPackageInstalls`, `ACTION_MANAGE_UNKNOWN_APP_SOURCES`). Without
  permission the setting opens and the error code is
  `E_OTA_INSTALL_PERMISSION`; tapping again continues.
- Error codes: `E_OTA_INSTALL_PERMISSION`, `E_OTA_APK_HTTP`, `E_OTA_NOT_APK`,
  `E_OTA_APK_CHECKSUM`, `E_OTA_APK_CANCELLED`, `E_OTA_APK_DOWNLOAD`,
  `E_OTA_APK_INSTALL`; one download at a time (`E_OTA_APK_BUSY`).

## Entry points

- JS: `OtaClient.downloadAndInstallAppUpdate()`, `cancelAppUpdateDownload()`,
  `addAppUpdateProgressListener()`, `supportsInAppAppUpdate()`. The provider's
  `openAppUpdate()` and the overlay's "Download new version" use them;
  `downloadKind` tells a bundle download from an APK download, and the overlay
  shows Cancel for the latter.
- Native-first flow: `OtaSplashActivity.installAppUpdate()` does the same
  before React Native starts; `OTAClient.pendingVersionUpdate()` gives it the
  version.

## Fallback

An engine built before 1.5.0 has no installer methods: JS opens the APK link
in the browser (`/app/update/version/{id}?did=&token=&api_key=`). The system's
install confirmation can never be skipped.
