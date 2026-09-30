'use strict';

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_BUNDLE_NAME = '@version.android.bundle';
const ANDROID_BUNDLE_NAME = 'index.android.bundle';
const MANIFEST_FILE = 'manifest.json';

class CliError extends Error {}

/** Absolute path of the host app, validated to look like a React Native project. */
function resolveProjectRoot(input) {
  const root = path.resolve(input || process.cwd());
  const pkgPath = path.join(root, 'package.json');

  if (!fs.existsSync(pkgPath)) {
    throw new CliError(`No package.json in ${root}. Pass --project-root <dir>.`);
  }

  return root;
}

/** `version` and `runtimeVersion` from the host's package.json. */
function readProjectVersions(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const problems = [];

  if (!pkg.name) {
    problems.push('"name" is missing from package.json');
  }

  if (!pkg.version) {
    problems.push('"version" is missing from package.json');
  }

  if (!pkg.runtimeVersion) {
    problems.push(
      '"runtimeVersion" is missing from package.json. It is the native runtime key and must ' +
        'equal versionName in android/app/build.gradle.',
    );
  }

  if (problems.length > 0) {
    throw new CliError(`Cannot build an OTA artifact:\n  - ${problems.join('\n  - ')}`);
  }

  return { name: pkg.name, version: pkg.version, runtimeVersion: pkg.runtimeVersion };
}

/** Expands `@version` and `@date` in a file name template. */
function expandBundleName(template, { runtimeVersion, version }, fallback) {
  const name = (template || fallback || DEFAULT_BUNDLE_NAME).trim();

  return name
    .replaceAll('@version', `${runtimeVersion}-${version}`)
    .replaceAll('@date', new Date().toISOString());
}

/** `{name}-{runtimeVersion}-{version}` unless overridden. */
function resolveArchiveName(template, versions) {
  const name = (template || '{name}-{runtimeVersion}-{version}').trim();

  return name
    .replaceAll('{name}', versions.name)
    .replaceAll('{runtimeVersion}', versions.runtimeVersion)
    .replaceAll('{version}', versions.version);
}

/** Path of the local `react-native` bin, so no network access is needed. */
function resolveReactNativeBin(root) {
  const suffix = process.platform === 'win32' ? '.cmd' : '';
  const local = path.join(root, 'node_modules', '.bin', `react-native${suffix}`);

  return fs.existsSync(local) ? local : null;
}

/** Runs the host's Metro bundler through the React Native CLI. */
function bundleJavaScript({ root, entryFile, bundleOutput, assetsDest, dev }) {
  const args = [
    'bundle',
    '--platform',
    'android',
    '--dev',
    dev ? 'true' : 'false',
    '--entry-file',
    entryFile,
    '--bundle-output',
    bundleOutput,
  ];

  if (assetsDest) {
    args.push('--assets-dest', assetsDest);
  }

  const bin = resolveReactNativeBin(root);
  const result = bin
    ? spawnSync(bin, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
    : spawnSync(`npx${process.platform === 'win32' ? '.cmd' : ''}`, ['--no-install', ...args], {
        cwd: root,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });

  if (result.error) {
    throw new CliError(`Failed to run the React Native bundler: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new CliError(`react-native bundle exited with code ${result.status}`);
  }

  if (!fs.existsSync(bundleOutput)) {
    throw new CliError(`The bundler did not produce ${bundleOutput}`);
  }
}

/** MD5 + byte size, the two fields the engine verifies after download. */
function describeFile(filePath) {
  const buffer = fs.readFileSync(filePath);

  return {
    checksum: crypto.createHash('md5').update(buffer).digest('hex'),
    size: fs.statSync(filePath).size,
  };
}

/** Writes `manifest.json` next to a bundle. */
function writeManifest(directory, versions, bundleFileName, extra = {}) {
  const { checksum, size } = describeFile(path.join(directory, bundleFileName));

  const manifest = {
    version: versions.version,
    runtimeVersion: versions.runtimeVersion,
    bundle: bundleFileName,
    checksum,
    size,
    createdAt: new Date().toISOString(),
    ...extra,
  };

  fs.writeFileSync(path.join(directory, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);

  return manifest;
}

function readManifest(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * `versionName` / `versionCode` from `android/app/build.gradle`.
 * Good enough to catch the one mistake that silently breaks OTA: a
 * `runtimeVersion` that does not match the APK.
 */
function readGradleVersions(root) {
  const gradlePath = path.join(root, 'android', 'app', 'build.gradle');
  const ktsPath = path.join(root, 'android', 'app', 'build.gradle.kts');

  const file = fs.existsSync(gradlePath) ? gradlePath : fs.existsSync(ktsPath) ? ktsPath : null;

  if (!file) {
    return { file: null, versionName: null, versionCode: null };
  }

  const source = fs.readFileSync(file, 'utf8');
  const name = source.match(/versionName\s*=?\s*["']([^"']+)["']/);
  const code = source.match(/versionCode\s*=?\s*(\d+)/);

  return {
    file,
    versionName: name ? name[1] : null,
    versionCode: code ? Number(code[1]) : null,
  };
}

function defaultAssetsDir(root) {
  return path.join(root, 'android', 'app', 'src', 'main', 'assets');
}

function defaultResDir(root) {
  return path.join(root, 'android', 'app', 'src', 'main', 'res');
}

function defaultReleaseDir(root, override) {
  return path.resolve(override || process.env.RELEASE_DIR || path.join(root, 'release'));
}

function tempDir(prefix = 'ota-client-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function removeQuietly(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

function ok(message) {
  log(`  ok    ${message}`);
}

function warn(message) {
  log(`  warn  ${message}`);
}

function fail(message) {
  log(`  FAIL  ${message}`);
}

module.exports = {
  ANDROID_BUNDLE_NAME,
  CliError,
  DEFAULT_BUNDLE_NAME,
  MANIFEST_FILE,
  defaultAssetsDir,
  defaultReleaseDir,
  defaultResDir,
  describeFile,
  expandBundleName,
  fail,
  log,
  ok,
  readGradleVersions,
  readManifest,
  readProjectVersions,
  removeQuietly,
  resolveArchiveName,
  resolveProjectRoot,
  resolveReactNativeBin,
  tempDir,
  warn,
  writeManifest,
  bundleJavaScript,
};
