'use strict';

const fs = require('fs');
const path = require('path');
const tar = require('tar');

const {
  CliError,
  MANIFEST_FILE,
  bundleJavaScript,
  defaultReleaseDir,
  expandBundleName,
  log,
  readGradleVersions,
  readProjectVersions,
  removeQuietly,
  resolveArchiveName,
  resolveProjectRoot,
  tempDir,
  writeManifest,
} = require('./project');

/**
 * Builds the archive the OTA server serves: the JS bundle plus its
 * `manifest.json`, both at the root of a `.tar.gz`.
 *
 *   ota-client release
 *
 * The engine downloads this file, verifies the manifest and the MD5, and stages
 * the bundle. Upload the result to whatever `app/update/bundle/{id}` returns.
 */
async function runRelease(options = {}) {
  const root = resolveProjectRoot(options.projectRoot);
  const versions = readProjectVersions(root);
  const outDir = defaultReleaseDir(root, options.out);
  const archiveName = `${resolveArchiveName(options.name, versions)}.tar.gz`;
  const archivePath = path.join(outDir, archiveName);

  assertRuntimeMatchesApk(root, versions, options.force === true);

  fs.mkdirSync(outDir, { recursive: true });

  if (options.skipBuild) {
    if (!fs.existsSync(archivePath)) {
      throw new CliError(`--skip-build was passed but ${archivePath} does not exist`);
    }

    log(`Reusing ${archivePath}`);
    return { archivePath };
  }

  const bundleFileName = expandBundleName(options.bundleName || process.env.BUILD_BUNDLE_NAME, versions);
  const entryFile = options.entryFile || 'index.js';
  const stagingDir = tempDir('ota-client-release-');

  try {
    const bundleOutput = path.join(stagingDir, bundleFileName);

    log(`Bundling ${versions.name} v${versions.version} (runtime ${versions.runtimeVersion})`);
    log(`  -> ${bundleOutput}`);

    bundleJavaScript({ root, entryFile, bundleOutput, assetsDest: null, dev: false });

    const manifest = writeManifest(stagingDir, versions, bundleFileName);

    await tar.create({ gzip: true, file: archivePath, cwd: stagingDir }, [bundleFileName, MANIFEST_FILE]);

    log(`Created ${archivePath}`);
    log(`  md5:   ${manifest.checksum}`);
    log(`  size:  ${manifest.size} bytes`);
    log('');
    log(`Upload this file to the update server, then publish it as bundle ${versions.version}.`);
    log(`A device only accepts it while its APK versionName is ${versions.runtimeVersion}.`);

    return { archivePath, manifest };
  } finally {
    removeQuietly(stagingDir);
  }
}

/**
 * The engine refuses any bundle whose `runtimeVersion` differs from the APK's
 * `versionName`, so a mismatch has to be caught on the build machine — otherwise
 * every device silently keeps the old bundle.
 */
function assertRuntimeMatchesApk(root, versions, force) {
  const gradle = readGradleVersions(root);

  if (!gradle.versionName) {
    return;
  }

  if (gradle.versionName === versions.runtimeVersion) {
    return;
  }

  const message =
    `package.json runtimeVersion is "${versions.runtimeVersion}" but ` +
    `${path.relative(root, gradle.file)} sets versionName "${gradle.versionName}".\n` +
    '  Devices discard bundles built for a different native runtime, so this update ' +
    'would never install.\n' +
    '  Make both values identical (a runtime change needs a new APK).';

  if (force) {
    log(`  warn  ${message}`);
    return;
  }

  throw new CliError(message);
}

module.exports = { runRelease };
