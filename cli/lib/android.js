'use strict';

const fs = require('fs');
const path = require('path');

const {
  ANDROID_BUNDLE_NAME,
  CliError,
  bundleJavaScript,
  defaultAssetsDir,
  defaultResDir,
  expandBundleName,
  log,
  readProjectVersions,
  resolveProjectRoot,
  writeManifest,
} = require('./project');

/**
 * Builds the bundle that ships *inside* the APK.
 *
 * The result is what a device falls back to when there is no OTA bundle, so it
 * must be produced before every release APK:
 *
 *   ota-client android
 */
async function runAndroid(options = {}) {
  const root = resolveProjectRoot(options.projectRoot);
  const versions = readProjectVersions(root);

  const assetsDir = path.resolve(options.assetsDest || process.env.ANDROID_ASSETS_DIR || defaultAssetsDir(root));
  const resDir = path.resolve(options.resDest || process.env.ANDROID_RES_DIR || defaultResDir(root));
  const bundleFileName = expandBundleName(options.bundleName || process.env.BUILD_BUNDLE_NAME, versions, ANDROID_BUNDLE_NAME);
  const entryFile = options.entryFile || 'index.js';
  const dev = options.dev === true || options.dev === 'true';

  fs.mkdirSync(assetsDir, { recursive: true });
  fs.mkdirSync(resDir, { recursive: true });

  const bundleOutput = path.join(assetsDir, bundleFileName);

  log(`Bundling ${versions.name} v${versions.version} (runtime ${versions.runtimeVersion})`);
  log(`  -> ${bundleOutput}`);

  bundleJavaScript({ root, entryFile, bundleOutput, assetsDest: resDir, dev });

  const manifest = writeManifest(assetsDir, versions, bundleFileName);

  log(`  manifest: ${path.join(assetsDir, 'manifest.json')}`);
  log(`  md5:      ${manifest.checksum}`);
  log(`  size:     ${manifest.size} bytes`);

  if (bundleFileName !== ANDROID_BUNDLE_NAME && !fs.existsSync(path.join(assetsDir, ANDROID_BUNDLE_NAME))) {
    throw new CliError(
      `No ${ANDROID_BUNDLE_NAME} in ${assetsDir}. React Native only loads the bundle that the ` +
        'APK contains, so either keep the default name or point bundleAssetName at it in ' +
        'android/app/build.gradle.',
    );
  }

  return { assetsDir, resDir, manifest };
}

module.exports = { runAndroid };
