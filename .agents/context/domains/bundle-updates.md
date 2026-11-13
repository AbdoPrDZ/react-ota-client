# Bundle Updates

Replacing the JS bundle without a new APK. The engine's main job.

## Archive

`{name}-{runtimeVersion}-{version}.tar.gz` built by `react-ota-client release`:
the bundle, `manifest.json` (`version`, `runtimeVersion`, `bundle`, size, MD5,
optional `fonts` list), and optionally `fonts/` and `assets/`.

## Download and staging (`utils/OTAClient`)

1. Stream to `filesDir/ota-new-update-{ts}/archive.tar.gz` (progress events).
2. Extract to `extracted/`, rejecting entries that escape the directory.
3. Require `manifest.json` and the named bundle; verify size and MD5
   (`ota_client_verify_checksum`).
4. Copy to `filesDir/{runtimeVersion}-{version}/` with `fonts/` and `assets/`.
   Never overwrite the running bundle. Old directories are pruned to
   `ota_client_keep_bundles` (default 2).

## Swap and rollback (`ota/OtaBundleProvider`)

- `installBundle()` sets `RUNNING_BUNDLE_DIR`, keeps the previous one as
  `LAST_GOOD_BUNDLE_DIR`, and relaunches.
- A new bundle is **provisional**: the PID that started it is stored, and only
  `markLaunchSucceeded()` clears it (the provider calls it a few seconds after
  mount). If a later process start still sees a pending PID from another
  process, the bundle never booted: restore the last good one, or the embedded
  bundle. A broken release heals on the second launch and reports
  `update.rollback`.
- A bundle is skipped when its runtimeVersion doesn't match the APK.
- OTA bundles are ignored in debuggable builds unless
  `ota_client_allow_in_debug`.

## Fonts and images

- Fonts: every `.ttf`/`.otf` in `fonts/` is registered with
  `ReactFontManager.addCustomFont()` under its file name without extension,
  during boot, so it overrides the APK copy (that is what
  `react-native-vector-icons` uses as the family).
- Images: React Native has no override hook for `require()`d images, so bundle
  images live in `assets/` and are addressed by path: `OTAImage`,
  `useBundleAssetUri`, `bundleAssetUri` build a `file://` URI from the active
  bundle directory. Always keep the `require()` fallback: the directory is
  `null` while the embedded bundle runs.
