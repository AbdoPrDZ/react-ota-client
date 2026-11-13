# Conventions

## Compatibility

- React Native 0.71+ (tested on 0.85 with the New Architecture), Android minSdk
  24. AGP and Kotlin versions come from the host project.
- The bridge is an old-style `NativeModules.OtaClient` module; keep it working
  under the New Architecture interop layer.
- JS must tolerate an engine without a newer native method (an app built before
  the method existed): check for the method and fall back, as the APK install
  falls back to the browser link.
- Never block the app on the server: the provider renders the app on any
  failure, events are fire-and-forget, a bad bundle rolls back by itself.

## Keep in sync

- **Version numbers**: `package.json` `version` = `LIBRARY_VERSION` in
  `android/build.gradle`.
- **JS ↔ Kotlin**: `src/types.ts` mirrors the JSON from `OtaClientModule`;
  error codes in `src/internal/errors.ts` (`OTA_APK_ERRORS`, `E_OTA_*`) and event
  names in `OTA_EVENTS` match the Kotlin constants.
- **With `expo-ota-client`** (`E:\OTA\exo-ota-client`): same OTACenter device
  API, activity event names, APK error codes and overlay behaviour where they
  overlap. A fix to `ApkInstaller` usually belongs in both (both are ports of
  OTAStore's).
- **With OTACenter**: routes, headers and response fields (`server-api.md`).
- **Public API**: everything exported from `src/index.ts`; document it in the
  README and the CHANGELOG.

## Code style

- TypeScript strict in `src/`; ESLint `@react-native` config, Prettier 2.
- CommonJS JavaScript in `cli/` and `scripts/` (run directly by Node).
- Kotlin in `com.otaclient`; settings keys `ota_client_*`.
- Short doc comments that say what and why.

## Docs

- `README.md` is the user guide; `CHANGELOG.md` follows Keep a Changelog, with
  the next release as `Unreleased`.
- Update this context (`.agents/context/`) when architecture, the server
  contract, workflows or a domain changes (update mode: automatic).
