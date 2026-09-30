'use strict';

const fs = require('fs');
const path = require('path');

const {
  MANIFEST_FILE,
  defaultAssetsDir,
  fail,
  log,
  ok,
  readGradleVersions,
  readManifest,
  readProjectVersions,
  resolveProjectRoot,
  warn,
} = require('./project');

/**
 * Checks that a host project can actually receive OTA updates.
 *
 *   ota-client doctor
 *
 * Every check maps to a way the engine fails silently in production, so this is
 * the command to run when an update "does nothing" on a device.
 */
async function runDoctor(options = {}) {
  const root = resolveProjectRoot(options.projectRoot);
  const problems = [];

  log(`\nota-client doctor — ${root}\n`);

  // 1. Versions -------------------------------------------------------------
  let versions = null;

  try {
    versions = readProjectVersions(root);
    ok(`package.json: ${versions.name} v${versions.version} (runtime ${versions.runtimeVersion})`);
  } catch (error) {
    fail(error.message);
    problems.push(error.message);
  }

  // 2. APK version must equal runtimeVersion --------------------------------
  if (versions) {
    const gradle = readGradleVersions(root);

    if (!gradle.file) {
      warn('android/app/build.gradle not found — skipped the runtime check');
    } else if (!gradle.versionName) {
      warn('could not read versionName from android/app/build.gradle');
    } else if (gradle.versionName === versions.runtimeVersion) {
      ok(`APK versionName ${gradle.versionName} matches runtimeVersion`);
    } else {
      const message =
        `versionName "${gradle.versionName}" in android/app/build.gradle does not match ` +
        `runtimeVersion "${versions.runtimeVersion}". The engine discards bundles built for a ` +
        'different native runtime, so updates will never install.';

      fail(message);
      problems.push(message);
    }
  }

  // 3. Embedded manifest ----------------------------------------------------
  const manifestPath = path.join(defaultAssetsDir(root), MANIFEST_FILE);

  if (!fs.existsSync(manifestPath)) {
    const message = `No ${manifestPath}. Run \`npx ota-client android\` before building the APK.`;
    fail(message);
    problems.push(message);
  } else {
    const manifest = readManifest(manifestPath);

    if (!manifest) {
      const message = `${manifestPath} is not valid JSON.`;
      fail(message);
      problems.push(message);
    } else if (versions && (manifest.version !== versions.version || manifest.runtimeVersion !== versions.runtimeVersion)) {
      const message =
        `${manifestPath} describes v${manifest.version} (runtime ${manifest.runtimeVersion}) but ` +
        `package.json is v${versions.version} (runtime ${versions.runtimeVersion}). ` +
        'Re-run `npx ota-client android`.';

      fail(message);
      problems.push(message);
    } else {
      ok(`embedded manifest: v${manifest.version} (runtime ${manifest.runtimeVersion})`);
    }
  }

  // 4. Bundle provider wiring ----------------------------------------------
  const wiring = findWiring(root);

  if (wiring.length === 0) {
    const message =
      'OtaBundleProvider.getJSBundleFile() is not referenced in MainApplication, so downloaded ' +
      'bundles would never be loaded. See the README section "Wire up the bundle provider".';
    fail(message);
    problems.push(message);
  } else {
    ok(`bundle provider wired in ${wiring.map((file) => path.basename(file)).join(', ')}`);
  }

  // 5. Server coordinates ---------------------------------------------------
  const manifestXml = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

  if (!fs.existsSync(manifestXml)) {
    warn('android/app/src/main/AndroidManifest.xml not found');
  } else if (fs.readFileSync(manifestXml, 'utf8').includes('ota_client_api_base_url')) {
    ok('API base URL configured in AndroidManifest.xml');
  } else {
    warn(
      'no ota_client_api_base_url meta-data. That is fine when the app calls ' +
        'OtaClient.configure() from JS; otherwise the first launch shows the configure screen.',
    );
  }

  // Summary -----------------------------------------------------------------
  log('');

  if (problems.length === 0) {
    log('All checks passed. Publish an update with: npx ota-client release');
  } else {
    log(`${problems.length} problem(s) found. Fix them before publishing an update.`);
  }

  return { ok: problems.length === 0, problems };
}

const APPLICATION_CLASS_FILES = ['MainApplication.kt', 'MainApplication.java'];

function findWiring(root) {
  const javaRoot = path.join(root, 'android', 'app', 'src', 'main', 'java');
  const kotlinRoot = path.join(root, 'android', 'app', 'src', 'main', 'kotlin');
  const found = [];

  for (const base of [javaRoot, kotlinRoot]) {
    for (const fileName of APPLICATION_CLASS_FILES) {
      const matches = [...walk(base)].filter((file) => path.basename(file) === fileName);

      for (const file of matches) {
        if (fs.readFileSync(file, 'utf8').includes('OtaBundleProvider')) {
          found.push(file);
        }
      }
    }
  }

  return found;
}

function* walk(directory) {
  let entries;

  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

module.exports = { runDoctor };
