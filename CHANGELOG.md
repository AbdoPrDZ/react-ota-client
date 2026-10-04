# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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