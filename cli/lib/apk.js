'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { runAndroid } = require('./android');
const { CliError, defaultReleaseDir, log, readProjectVersions, resolveProjectRoot } = require('./project');

/**
 * Builds the release APK and copies it into `release/`.
 *
 *   ota-client apk
 *
 * The embedded bundle is rebuilt first, so the APK always ships the JS it was
 * tested with. Release builds must be signed with your own keystore — see
 * android/app/build.gradle.
 */
async function runApk(options = {}) {
  const root = resolveProjectRoot(options.projectRoot);
  const versions = readProjectVersions(root);
  const androidDir = path.join(root, 'android');
  const outDir = defaultReleaseDir(root, options.out);

  if (!fs.existsSync(path.join(androidDir, 'gradlew'))) {
    throw new CliError(`No Gradle wrapper in ${androidDir}`);
  }

  if (!options.skipBundle) {
    await runAndroid({ projectRoot: root });
  }

  const gradlew = path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  const args = ['assembleRelease', ...(options.gradleArgs || [])];

  log(`\nRunning ${path.basename(gradlew)} ${args.join(' ')}`);

  const result = spawnSync(gradlew, args, {
    cwd: androidDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw new CliError(`Gradle failed to start: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new CliError(`gradlew ${args.join(' ')} exited with code ${result.status}`);
  }

  const produced = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');

  if (!fs.existsSync(produced)) {
    throw new CliError(`Expected an APK at ${produced}. Check the build variant name.`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const apkName = `${versions.name}-${versions.version}.apk`;
  const apkPath = path.join(outDir, apkName);

  fs.copyFileSync(produced, apkPath);

  log(`\nCreated ${apkPath}`);

  return { apkPath };
}

module.exports = { runApk };
