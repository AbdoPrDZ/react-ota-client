# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-10-05

### Added

- **Activity reporting.** The engine can now tell the server what it did, so a
  center can keep a per-device / per-app audit trail. `OtaClient.reportEvent()`
  posts to `POST {apiRoot}/app/event` (form-encoded, authorised with the same
  `API-KEY` and `X-Device-Info`), and `OTAProvider` / `useOTAFlow` report the
  user-driven events automatically: `update.available` after a check that finds
  something, `update.refused` when the user dismisses the prompt, and
  `update.downloaded` / `update.failed` around a download. Set
  `reportEvents={false}` to opt out; every report is fire-and-forget and never
  fails the update flow.
- **Rollback and launch events from native.** Because they happen before
  JavaScript runs, the engine reports `update.rollback` (a provisional bundle
  reverted at startup) and `bundle.launch_confirmed` (the active bundle booted)
  itself.

## [1.3.1] - 2026-10-05

### Fixed

- **The APK install link was rejected with 401.** `appUpdateUrl()` appends the
  configured API key as `&api_key=<url-encoded>` because the link is opened by the
  OS browser, which cannot set the `API-KEY` header — so the server answered 401
  and the new version could not be installed. Needs a server that accepts the key
  from the query (OTACenter 1.5.2+); older servers simply ignore the parameter.

## [1.3.0] - 2026-10-05

### Added

- **Forced updates.** The update check now carries the server's `updateType`
  (`optional` or `force`) on each offered update (`UpdateInfo.updateType` in
  Kotlin, `OtaUpdateInfo.updateType` / `OtaUpdateType` in TS). When a pending
  version or bundle update is `force`, the built-in overlay hides "Not now",
  blocks the back gesture and `dismissUpdate()` becomes a no-op for the session;
  `forceUpdate` is exposed on the context so a custom UI can comply too. Servers
  that omit the field are treated as `optional`, so the change is backward
  compatible both ways.

## [1.2.0] - 2026-10-05

### Added

- **A bundle can now ship its own images.** 1.1.0 made fonts updatable but left
  images behind, because a `require()`d image resolves through
  `ResourceDrawableIdHelper` → `resources.getIdentifier()` against the APK, and
  React Native exposes no override for it the way `ReactFontManager.addCustomFont`
  covers fonts. An archive may now carry an `assets/` directory, and JavaScript
  reaches those files through a `file://` URI built from the active bundle
  directory, which Fresco loads without any resource lookup.
  - `BundleState` gained `directory`, the real staging directory. It is surfaced
    through `getState().bundle.directory` and typed on `OtaBundleInfo`. Deriving it
    from `path` on the JS side would have broken on the next layout change, so the
    engine reports it directly.
  - `bundleAssetUri(directory, name)` and `useBundleAssetUri(name)` build the URIs.
  - `OTAImage` wraps `Image`, preferring the copy carried by the active bundle and
    falling back to the `require()`d one. The fallback is required: `directory` is
    `null` whenever the embedded APK copy is running, which is every device that
    has not installed an update yet.
  - Staging was generalised from `stageFonts()` to `stageDirectory()`, which now
    copies both `fonts/` and `assets/`. Staging still only ever kept the bundle and
    `manifest.json` before 1.1.0.
- README: "Shipping images with a bundle" covering the archive layout, `OTAImage`
  usage, and the required fallback.

### Changed

- `BundleState` gained a `directory` field. It is internal to the engine, but any
  code constructing it directly must pass the new argument.

## [1.1.0] - 2026-10-05

### Added

- **A bundle can now ship its own fonts.** React Native resolves a font family
  from `assets/fonts/<family>` inside the APK only, so an OTA update could never
  change a font: new glyphs silently rendered as tofu. An archive may now carry
  a `fonts/` directory, and the engine registers each file through
  `ReactFontManager.addCustomFont()` before the first icon renders. Registering
  under the file name without its extension matches what
  `react-native-vector-icons` passes as the family on Android.
  - `downloadBundle()` copies `<archive>/fonts` into the staging directory.
    Staging previously kept only the bundle and `manifest.json`, so anything
    else in the archive was dropped.
  - Registration happens in `getJSBundleFile()`, which React Native calls while
    booting. The custom typeface cache lives for the whole process, so this is
    the only point at which it can be populated; a font change always arrives
    with the restart that follows an activation.
  - A font that fails to load is logged and skipped, leaving the APK copy in
    place rather than blocking the launch.
- README: a "Shipping fonts with a bundle" section covering the archive layout,
  the family-name rule, and why images are deliberately *not* archived.

### Known limitations

- **Images could not be OTA-updated on Android.** A `require()`d image resolves
  through `ResourceDrawableIdHelper` → `resources.getIdentifier()`, and React
  Native exposes no override for it, unlike fonts. **Addressed in 1.2.0**, which
  stages `assets/` next to the bundle and reads it through `file://` URIs.

## [1.0.1] - 2026-10-04

### Fixed

- **Manifest meta-data was ignored, so the server was never contacted.**
  `OtaHost.applicationMetaData()` read `applicationInfo.metaData`, which is
  `null` inside the app process because the cached `ApplicationInfo` is built
  without `GET_META_DATA`. Every `ota_client_*` key silently fell back to its
  default, which left `apiBaseUrl` blank and made `healthCheck()` return `false`
  without logging. It now goes through
  `PackageManager.getApplicationInfo(packageName, GET_META_DATA)`.
- **`checkForUpdates()` could not open the update overlay.** It only stored the
  result and never moved `status`, while `OTAUpdateOverlay` derives its
  visibility from `status`. A manual check now sets `status` to
  `update-available` or `ready`, so `autoCheck={false}` works as intended.
- **A missing API base URL failed silently.** `healthCheck()` and `appInfo()`
  now log a warning naming the meta-data key to set.

### Added

- README: a "Checking on your own schedule" section for the
  `autoCheck={false}` + `checkForUpdates()` pattern, and troubleshooting entries
  for a missing base URL and for the overlay staying hidden.

## [1.0.0]

- Initial release.