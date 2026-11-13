# Workflows

## Package

| Command | Does |
| --- | --- |
| `npm run build` | `scripts/build.js`: esbuild bundles `src/index.ts` → `dist/index.js` (CJS, minified, platform neutral, es2020, jsx automatic; peers, deps, `react/*`, `react-native/*` external) and `cli/index.js` → `dist/cli/index.js` (node18, shebang, chmod 755); then `tsc -p tsconfig.build.json` emits `.d.ts` only to `dist/types/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` / `format` | ESLint (`@react-native/eslint-config`) / Prettier on `src/` |
| `npm pack --dry-run` | Check what ships: `dist/`, `android/` (all `.kt`), `react-native.config.js`, README, CHANGELOG, LICENSE |

- `prepare` runs the build, so `npm install` and **git installs** produce
  `dist/` (npm installs devDependencies for git deps, so esbuild and TypeScript
  are available). `prepublishOnly` runs the typecheck. `dist/` is git-ignored.
- The minified output is intentional (the owner wants shipped JS unreadable): no
  source maps. The `.d.ts` files and Kotlin stay readable by necessity.
- `.npmignore` source patterns are root-anchored (`/src/`, `/cli/`,
  `/scripts/`); a bare `src/` would also drop `android/src/`.
- There are no unit tests in the repo. Verification is typecheck, lint, and
  building a host app.

## Testing the engine in a host app

The Kotlin code compiles only inside an app. OTAStore (`E:\OTA\OTAStore`)
depends on this package from GitHub (still as `ota-client` at tag `v1.4.0`);
to compile a local checkout without changing OTAStore, use a Gradle init
script that points its autolinked project (`:ota-client` there,
`:react-ota-client` from 1.5.0) at this repo's `android/` directory. A JS-level change needs a Metro
bundle of a host app against `dist/`.

## CLI (in a host app)

Command `react-ota-client`; `ota-client` is kept as an alias for 1.4.x scripts.

- `react-ota-client android`: bundle the JS into `android/app/src/main/{assets,res}`
  for the base APK.
- `react-ota-client release`: build the OTA archive (bundle + `manifest.json`, plus
  `fonts/` and `assets/` when present) into `release/`. Fails when
  `runtimeVersion` ≠ APK `versionName` unless `--force`.
- `react-ota-client apk`: rebuild the embedded bundle, `gradlew assembleRelease`, copy
  the APK to `release/`.
- `react-ota-client doctor`: check the host wiring.
- `.env` is loaded (`dotenv`); env overrides such as `BUILD_BUNDLE_NAME`,
  `RELEASE_DIR`.

Uploading is done in the OTACenter dashboard (this CLI has no publish command;
`expo-ota-client`'s does).

## Releasing the package

Published on npm (`react-ota-client`). Releases run from a developer machine,
not CI (GitHub Actions is unavailable on this account):

1. Bump `version` in `package.json` and `LIBRARY_VERSION` in
   `android/build.gradle` (they must match), add and date the `CHANGELOG.md`
   entry (`## [x.y.z] - YYYY-MM-DD`), commit and push `main`.
2. `npm run release -- --dry-run`, then `npm run release`
   (`scripts/release.js`): checks a clean, pushed `main`, the dated entry and
   `LIBRARY_VERSION`, `npm publish` (typecheck via `prepublishOnly`), pushes
   tag `vX.Y.Z`, and creates the GitHub release with the CHANGELOG notes.
   Each step skips if already done. Pre-release versions go to the `next`
   dist-tag.

Needs `npm login` (or a token in `~/.npmrc`) and `gh auth login`. Git
consumers can still pin a tag (`github:AbdoPrDZ/react-ota-client#vX.Y.Z`).
