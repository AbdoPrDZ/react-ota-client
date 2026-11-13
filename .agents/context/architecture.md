# Architecture

`ota-client` (npm name; the repo is `react-ota-client`) gives **bare React
Native apps on Android** over-the-air JS bundle updates from **OTACenter**, the
team's own update server (Laravel, `E:\OTA\OTACenter`). Unlike its Expo sibling
`expo-ota-client`, it brings its **own native engine**. The two must never be in
the same app. iOS is unsupported: every API rejects with
`OtaUnsupportedPlatformError` and the components render the app untouched.

## Parts

| Part | Source | Ships as | Runs in |
| --- | --- | --- | --- |
| Kotlin engine | `android/` (`com.otaclient`), autolinked via `react-native.config.js` | Source, compiled by the host app | The app |
| JS API and components | `src/` (TypeScript, React) | `dist/index.js` (minified) + `dist/types/` | The app |
| CLI | `cli/index.js`, `cli/lib/` | `dist/cli/index.js` (bin `ota-client`) | Developer machine (Node 18+) |

## Kotlin engine (`android/src/main/java/com/otaclient/`)

- `ota/OtaBundleProvider`: called from the host's `getJSBundleFile()`. Picks the
  bundle to boot (rollback check, runtimeVersion match, file present) or `null`
  for the APK's embedded bundle. The one thing a host must wire up.
- `utils/OTAClient`: the engine: health check, `checkUpdate` (`/app/info`),
  bundle download with progress, extraction and verification, APK URL,
  activity events. Ktor CIO + Gson; `commons-compress` for `.tar.gz`.
- `ota/OtaConfig`: settings from manifest meta-data (`ota_client_*`), overridden
  by runtime values from `OtaClient.configure()` (stored in `utils/AppStorage`);
  restart helpers.
- `ota/ApkInstaller`, `OtaApkFileProvider`: in-app APK install
  (`domains/native-updates.md`).
- `ota/OtaSplashActivity`, `OtaConfigureActivity`: optional native-first flow
  (the check runs before React Native starts). Don't combine with the JS
  provider's automatic check.
- `OtaClientModule` (`NativeModules.OtaClient`, old-style bridge module) +
  `OtaClientPackage`: the JS bridge and its events.
- `data/`: JSON shapes (`AppInfo`, `CheckUpdate`, `Manifest`, `BundleState`,
  `DeviceInfo`).

## JS layer (`src/`)

- `internal/nativeModule.ts`: the only place that touches `NativeModules`;
  `isNativeAvailable`, `OTA_EVENTS`.
- `OtaClient.ts`: typed imperative API over the module.
- `components/OTAProvider.tsx` + `internal/useOTAFlow.ts`: the launch flow and
  state (`context.ts`, `hooks/useOTA.ts`): configure → state → health → check →
  download → install (restart), launch confirmation after a delay.
- UI: `OTAUpdateOverlay`, `OTASplashScreen` (boot fallback),
  `OTAConfigureScreen` (server setup when no URL is known), `OTAImage` +
  `bundleAssets.ts` (images shipped in a bundle).
- `types.ts` mirrors the JSON the native module returns; `internal/errors.ts`
  maps native error codes to typed errors.

## Versioning model

- `runtimeVersion` in the host's `package.json` = APK `versionName` = the
  OTACenter version name. A bundle only installs on a matching runtime.
- `version` in `package.json` is the bundle version. Archive and bundle names
  default to `{name}-{runtimeVersion}-{version}`.
