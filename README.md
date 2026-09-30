# ota-client

Over-the-air JavaScript bundle updates for React Native on **Android**.

A device ships one JS bundle inside the APK. `ota-client` lets that bundle be
replaced at runtime: the app asks your server whether a newer bundle exists,
downloads it, verifies it, swaps it in and restarts into it — no app store
release, no new APK.

- **Native engine** in Kotlin (Ktor + `commons-compress`), autolinked into your app.
- **Typed JS API** plus ready-made React components (`<OTAProvider>` and friends).
- **CLI** to build the bundle that ships in the APK and the OTA archive you upload.
- **Automatic rollback**: a bundle that fails to boot reverts by itself, so a bad
  update cannot brick an installed app.

> Android only. The engine is a Kotlin module; on iOS every API call rejects with
> `OtaUnsupportedPlatformError` and the components render your app untouched.

---

## Requirements

| | |
| --- | --- |
| React Native | 0.71+ (tested on 0.85, New Architecture enabled) |
| Android | minSdk 24, compileSdk 35+ |
| AGP / Kotlin | 8.12 / 2.1.20 (inherited from the host project) |
| Node | 18+ for the CLI |

## Install

```sh
npm install ota-client
# or
yarn add ota-client
```

The Android module is picked up by autolinking. Confirm it:

```sh
npx react-native config | grep ota-client
```

### Migrating from the in-app engine

If you copied the engine into your app earlier (a `com.otaclient.utils.OTAClient`,
`com.otaclient.utils.AppStorage` and friends), **delete those files** before
installing — the library ships the same fully qualified class names, and two
copies of one class fail the build. Concretely:

```sh
rm -rf android/app/src/main/java/com/otaclient/{utils,data,ota}
rm -f  android/app/src/main/java/com/otaclient/{SplashActivity,ConfigureActivity}.kt
```

Then add the one-line `getJSBundleFile()` override, point `AndroidManifest.xml`
at the meta-data, and delete the app-local copy of `scripts/`.

---

## Quick start

### 1. Give your package.json a `runtimeVersion`

`runtimeVersion` is the **native runtime key**. It must equal `versionName` in
`android/app/build.gradle`; the engine refuses any bundle built for a different
one, because a bundle can only use native APIs that already exist in the APK.

```jsonc
// package.json
{
  "name": "my-app",
  "version": "1.0.0",      // bundle version
  "runtimeVersion": "1.0.0" // must match versionName in build.gradle
}
```

### 2. Wire up the bundle provider

The engine decides what React Native loads. Add one line to your
`MainApplication`:

```kotlin
// android/app/src/main/java/com/myapp/MainApplication.kt
import com.otaclient.ota.OtaBundleProvider

class MainApplication : Application(), ReactApplication {

  private val rnHost = object : DefaultReactNativeHost(this) {
    override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG
    override fun getPackages() = PackageList(this).packages
    override fun getJSMainModuleName(): String = "index"

    // The only required integration point.
    override fun getJSBundleFile(): String? = OtaBundleProvider.getJSBundleFile(applicationContext)
  }

  // … reactHost / onCreate as usual
}
```

Returning `null` (the default when no OTA bundle is active, in debug builds, or
after a rollback) hands control back to React Native, which serves the bundle
inside the APK or connects to Metro.

`ota-client doctor` verifies this wiring for you.

### 3. Tell it where your server is

Either commit the coordinates as Android manifest meta-data:

```xml
<!-- android/app/src/main/AndroidManifest.xml -->
<application>
  <meta-data android:name="ota_client_api_base_url" android:value="https://updates.example.com" />
  <meta-data android:name="ota_client_api_version" android:value="v1" />
  <meta-data android:name="ota_client_api_key"    android:value="v1.xxxxxxxxxxxxxx" />
  <!-- Recommended: makes relaunching after a swap unambiguous. -->
  <meta-data android:name="ota_client_main_activity" android:value="com.myapp.MainActivity" />
</application>
```

…or pass them from JS at runtime (handy for staging environments, white-label
builds and per-user configuration):

```tsx
import { OtaClient } from 'ota-client';

await OtaClient.configure({
  apiBaseUrl: 'https://updates.example.com',
  apiVersion: 'v1',
  apiKey: API_KEY,
});
```

### 4. Wrap your app root

```tsx
import { OTAProvider } from 'ota-client';

export default function App() {
  return (
    <OTAProvider
      config={{ apiBaseUrl: 'https://updates.example.com', apiKey: API_KEY }}
      onUnreachable={() => track('ota_server_unreachable')}
    >
      <RootNavigator />
    </OTAProvider>
  );
}
```

That is the whole integration. On launch the provider reads the native state,
runs the health and update checks, shows a themed update dialog when the server
has something newer, and renders your app in every other case — including when
the server is unreachable, so your app still works offline.

### 5. Publish an update

```sh
npx ota-client release
```

Upload `release/my-app-1.0.0-1.0.1.tar.gz` to your server, publish it as the
current bundle, and the next app launch offers the update.

---

## How it works

```
launch ──► MainApplication.onCreate
              └─ getJSBundleFile() ──► OtaBundleProvider
                                        ├─ rollback an unconfirmed bundle
                                        ├─ runtimeVersion match?
                                        ├─ bundle file present?
                                        └─ return path | null
                     │
                     ▼
              React Native boots ──► OTAProvider
                                        ├─ configure()  (optional)
                                        ├─ getState()
                                        ├─ healthCheck()
                                        ├─ checkUpdate()
                                        ├─ downloadBundle()  ── progress events ──► overlay
                                        └─ installBundle()  ── swap + restart ──► next launch
```

### The swap

Bundles are staged in `filesDir/{runtimeVersion}-{version}/` and never overwrite
the previous one:

1. The archive is streamed to `filesDir/ota-new-update-{ts}/archive.tar.gz`.
2. It is expanded into `extracted/`, rejecting entries that escape the directory.
3. `manifest.json` and the named bundle must both exist.
4. Size and MD5 from the manifest are verified.
5. Only then is the bundle copied to its final directory.

`installBundle()` points `RUNNING_BUNDLE_DIR` at the new directory, remembers the
old one as `LAST_GOOD_BUNDLE_DIR`, and relaunches the app.

### Automatic rollback

An activated bundle is treated as provisional. The PID of the process that
started it is stored, and only `markLaunchSucceeded()` clears it — which
`OTAProvider` calls a couple of seconds after mount (configurable, or call it
yourself after your own smoke test).

If the next process start still sees a pending PID from a *different* process,
that bundle never booted, so the engine restores the previous one — or the copy
inside the APK when there is none. A white-screen release therefore heals itself
on the second launch.

### Update checks

- `healthCheck()` — `GET {base}/ota-client/{version}/health`
- `checkUpdate()` — `POST {base}/ota-client/{version}/app/info` with the host
  `package`, `version` (APK `versionName`) and `bundle` (active manifest version)
- `downloadBundle()` — `GET {base}/ota-client/{version}/app/update/bundle/{id}`
  with `Authorization: Bearer {session}`
- new APK — `GET {base}/ota-client/{version}/app/update/version/{id}?did={androidId}&token={session}`,
  opened with `ACTION_VIEW`

Every request carries `API-KEY` and
`X-Device-Info: did=…;mf=…;br=…;mdl=…;av=…;sdv=…`.

Responses use the envelope `{ success, message, data }`. Send `Content-Length` on
the bundle download if you want a determinate progress bar; without it the UI
shows an indeterminate one.

---

## JavaScript API

### Imperative

```ts
import OtaClient from 'ota-client';

OtaClient.isSupported(): boolean

OtaClient.configure(config): Promise<OtaServerConfig>   // { apiBaseUrl, apiVersion, apiKey }
OtaClient.getConfig(): Promise<OtaServerConfig>
OtaClient.getState(): Promise<OtaState>                  // app, bundle, device, runtime
OtaClient.getDeviceInfo(): Promise<OtaDeviceInfo>

OtaClient.healthCheck(): Promise<boolean>
OtaClient.checkUpdate(): Promise<OtaCheckUpdateResult>
OtaClient.downloadBundle(options?): Promise<OtaDownloadResult>
OtaClient.installBundle({ directory?, restart? }): Promise<void>
OtaClient.downloadAndInstall(options?): Promise<OtaDownloadResult>

OtaClient.markLaunchSucceeded(): Promise<void>
OtaClient.revertToEmbeddedBundle(): Promise<boolean>
OtaClient.cleanupOldBundles(keep?): Promise<number>
OtaClient.getBundleInfo(): Promise<OtaBundleInfo>

OtaClient.getAppUpdateUrl(): Promise<string>
OtaClient.openAppUpdate({ url? }): Promise<boolean>
OtaClient.restartApp(): Promise<void>

OtaClient.addDownloadProgressListener(cb): () => void
OtaClient.addErrorListener(cb): () => void
```

### Hooks

```tsx
import { useOTA, useOTABundleInfo } from 'ota-client';

function DebugBadge() {
  const { status, check, progress, downloadAndInstall, dismissUpdate } = useOTA();
  const bundle = useOTABundleInfo();

  console.log(bundle?.manifest.version, bundle?.source, status, check, progress);
}
```

### Components

| Component | Purpose |
| --- | --- |
| `<OTAProvider>` | Runs the flow, publishes context, renders the update overlay. |
| `<OTAUpdateOverlay>` | Prompt + download progress + failure state. Themed by props. |
| `<OTAConfigureScreen>` | Server setup form, shown when nothing is configured. |
| `<OTAConfigureModal>` | The same form as a modal. |
| `<OTASplashScreen>` | Neutral boot screen with the active bundle version. |

`<OTAProvider>` props beyond the flow options
(`autoCheck`, `confirmLaunch`, `confirmDelayMs`, `onUpdateAvailable`,
`onStatusChange`, `onError`, `onUnreachable`, `config`):

| Prop | Default | Meaning |
| --- | --- | --- |
| `bootFallback` | `<OTASplashScreen />` | Shown while native state is read. |
| `unconfiguredFallback` | `<OTAConfigureScreen />` | Shown when no API base URL is known. |
| `showUpdateOverlay` | `true` | Render the built-in blocking update UI. |
| `renderChildrenWhenUnsupported` | `true` | On iOS, render children instead of the boot screen. |

To build your own update screen, take the state and render what you like:

```tsx
<OTAProvider showUpdateOverlay={false} config={config}>
  <RootNavigator />
</OTAProvider>
```

```tsx
const { status, check, progress, downloadAndInstall } = useOTA();

if (status === 'update-available' && check?.haveBundleUpdate) {
  return <MyUpdateSheet onInstall={downloadAndInstall} />;
}
```

### Server setup at runtime

```tsx
import { OTAConfigureScreen, OtaClient } from 'ota-client';

// Full-screen form
<OTAConfigureScreen onConfigured={config => console.log(config)} />;

// Or open the built-in configure screen from a button
await OtaClient.configure({ apiBaseUrl: 'https://staging.example.com' });
```

---

## CLI

```
ota-client android    bundle the JS into android/app/src/main/{assets,res} for the base APK
ota-client release    build the OTA archive (bundle + manifest.json) into release/
ota-client apk        run gradlew assembleRelease and copy the APK into release/
ota-client doctor     verify the host project is ready to receive OTA updates
```

| Flag | Commands | Meaning |
| --- | --- | --- |
| `-r, --project-root <dir>` | all | Host app directory (defaults to cwd). |
| `-e, --entry-file <file>` | `android`, `release` | JS entry point, default `index.js`. |
| `-b, --bundle-name <name>` | `android`, `release` | Bundle file name; `@version` → `{runtimeVersion}-{version}`, `@date` → ISO timestamp. |
| `-o, --out <dir>` | `release`, `apk` | Output directory. |
| `--name <name>` | `release` | Archive base name, default `{name}-{runtimeVersion}-{version}`. |
| `--skip-build` | `release` | Reuse the archive already in `--out`. |
| `--force` | `release` | Do not fail when `runtimeVersion` and `versionName` disagree. |
| `--gradle-args <args…>` | `apk` | Extra Gradle arguments. |
| `--skip-bundle` | `apk` | Do not rebuild the embedded bundle first. |

Environment overrides: `BUILD_BUNDLE_NAME`, `BUILD_TMP_DIR`, `RELEASE_DIR`,
`ANDROID_ASSETS_DIR`, `ANDROID_RES_DIR`, `ANDROID_DIR`, and anything in your
`.env` (`require('dotenv')` is loaded by the CLI).

### Release workflow

```sh
# 1. JS changed, native did not.
npm version patch                 # bumps `version` only
npx ota-client release            # release/my-app-1.0.0-1.0.1.tar.gz
                                   # upload it, publish it as the current bundle

# 2. Native changed too: bump runtimeVersion, then ship a new APK.
#    package.json runtimeVersion and build.gradle versionName must match.
npm version minor
npx ota-client apk                # rebuilds the embedded bundle, then assembles
```

`release` fails when `runtimeVersion` and the APK `versionName` disagree, because
such an archive would be silently rejected on every device. Use `--force` to
override.

---

## Native-first flow (optional)

If you want the update to land even when the embedded bundle cannot start at all,
make the bundled splash the launcher. The check then runs before React Native:

```xml
<activity
    android:name="com.otaclient.ota.OtaSplashActivity"
    android:exported="true"
    android:noHistory="true"
    android:theme="@style/Theme.OtaClient.Splash">
  <intent-filter>
    <action android:name="android.intent.action.MAIN" />
    <category android:name="android.intent.category.LAUNCHER" />
  </intent-filter>
</activity>
```

The activity health-checks, prompts, downloads with a progress bar, activates the
bundle and relaunches your React Native activity (found via
`ota_client_main_activity`, or by scanning your manifest). It also ships
`OtaConfigureActivity` for the case where the server cannot be reached at all.

Do **not** combine this with `<OTAProvider>`'s automatic check — the bundle would
be checked twice. Either the native entry point or the JS flow, not both.

---

## Manifest meta-data reference

| Key | Default | Meaning |
| --- | --- | --- |
| `ota_client_api_base_url` | – | Scheme + host of the server. |
| `ota_client_api_version` | `v1` | API prefix. |
| `ota_client_api_key` | – | `API-KEY` header. |
| `ota_client_main_activity` | auto-detected | React Native activity class name. |
| `ota_client_enabled` | `true` | Master switch for the engine. |
| `ota_client_allow_in_debug` | `false` | Load OTA bundles in debuggable builds too. |
| `ota_client_auto_check` | `true` | Native-first flow: run the check on the splash. |
| `ota_client_show_configure` | `true` | Native-first flow: offer the configure screen. |
| `ota_client_verify_checksum` | `true` | Verify size and MD5 after download. |
| `ota_client_keep_bundles` | `2` | Staging directories to keep. |

Runtime values from `OtaClient.configure()` always win over meta-data, so you can
commit safe defaults and override them per build.

---

## Native API

```kotlin
import com.otaclient.ota.OtaBundleProvider
import com.otaclient.utils.OTAClient

// Bundle selection — the one thing you must wire up.
OtaBundleProvider.getJSBundleFile(applicationContext): String?
OtaBundleProvider.markLaunchSucceeded(context)
OtaBundleProvider.activate(context, directory: File?): BundleState
OtaBundleProvider.revertToEmbedded(context): Boolean
OtaBundleProvider.currentState(context): BundleState
OtaBundleProvider.cleanup(context, keep: Int): Int
OtaBundleProvider.isLaunchPending(context): Boolean

// Engine
val client = OTAClient.instance(context)
client.healthCheck(): Boolean
client.checkUpdate(): CheckUpdate
client.downloadBundle(check) { downloaded, total -> }.downloadDir
client.appUpdateUrl(): String

// Relaunch / installer
OtaConfig.restart(context)
OtaConfig.restartNow(context)
OtaConfig.openDownloadUrl(context, url): Boolean
```

Manual registration (only if you disabled autolinking):

```kotlin
override fun getPackages() = PackageList(this).packages.apply {
  add(OtaClientPackage())
}
```

---

## Troubleshooting

**`E_OTA_LINKING`** — the native module is missing. Rebuild the Android app
(`npx react-native run-android`); Metro reloads do not pick up native changes.
Check `npx react-native config` lists `ota-client`.

**Update never appears** — run `npx ota-client doctor`. The usual causes are a
`runtimeVersion` that does not match the APK `versionName`, an update published
for a different `package` name, or the server not reporting it in
`availableUpdates.bundle`.

**Progress bar spins forever** — the server omits `Content-Length`. Send it, e.g.
in Laravel: `response()->file($path, ['Content-Length' => Storage::disk('public')->size($file->path)])`.

**White screen after an update** — it should self-heal on the second launch via
the rollback described above. If it does not, the bundle threw *after*
`markLaunchSucceeded()`; make the confirmation later
(`confirmDelayMs={8000}`) or call `confirmLaunch()` after your own smoke test.

**Nothing happens in debug** — by design, the engine stands down in debuggable
builds so Metro serves the bundle. Set `ota_client_allow_in_debug` to `true` to
test the real path.

**Plain JS in a test environment** — the package ships TypeScript source, which
Metro compiles. Jest needs the RN preset to transform it; if your `transformIgnorePatterns`
is customised, make sure `ota-client` is not ignored.

## License

MIT
