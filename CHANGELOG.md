# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

- **Images cannot be OTA-updated on Android.** A `require()`d image resolves
  through `ResourceDrawableIdHelper` → `resources.getIdentifier()`, and React
  Native exposes no override for it, unlike fonts. Keep images in the APK and
  rebuild when they change; an archive must not rely on shipping them.

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