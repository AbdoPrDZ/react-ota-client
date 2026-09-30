#!/usr/bin/env node
'use strict';

/**
 * ota-client CLI.
 *
 * Runs against the *host* React Native project (your app), not this package:
 *
 *   ota-client doctor     check the host is wired up correctly
 *   ota-client android    build the bundle embedded in the APK
 *   ota-client release    build the OTA archive to upload to the server
 *   ota-client apk        build the release APK
 */

require('dotenv').config({ quiet: true });

const { program } = require('commander');

const pkg = require('../package.json');
const { runAndroid } = require('./lib/android');
const { runApk } = require('./lib/apk');
const { runDoctor } = require('./lib/doctor');
const { runRelease } = require('./lib/release');

program
  .name('ota-client')
  .description('Build tooling for ota-client over-the-air bundle updates')
  .version(pkg.version);

program
  .command('android')
  .description('bundle the JS into android/app/src/main/{assets,res} for the base APK')
  .option('-r, --project-root <dir>', 'host app directory', process.cwd())
  .option('-e, --entry-file <file>', 'JS entry point', 'index.js')
  .option('-b, --bundle-name <name>', 'bundle file name, @version/@date are expanded')
  .option('--assets-dest <dir>', 'assets output directory')
  .option('--res-dest <dir>', 'drawable output directory')
  .option('--dev <bool>', 'dev mode bundle', 'false')
  .action((options) => {
    runAndroid(options).catch(fail);
  });

program
  .command('release')
  .description('build the OTA archive (bundle + manifest.json) into release/')
  .option('-r, --project-root <dir>', 'host app directory', process.cwd())
  .option('-e, --entry-file <file>', 'JS entry point', 'index.js')
  .option('-b, --bundle-name <name>', 'bundle file name, @version/@date are expanded')
  .option('-o, --out <dir>', 'output directory', process.env.RELEASE_DIR)
  .option('--name <name>', 'archive base name', '{name}-{runtimeVersion}-{version}')
  .option('--skip-build', 'reuse the archive that already exists in --out')
  .option('--force', 'do not fail when runtimeVersion and the APK versionName disagree')
  .action((options) => {
    runRelease(options).catch(fail);
  });

program
  .command('apk')
  .description('run gradlew assembleRelease and copy the APK into release/')
  .option('-r, --project-root <dir>', 'host app directory', process.cwd())
  .option('-o, --out <dir>', 'output directory', process.env.RELEASE_DIR)
  .option('--gradle-args <args...>', 'extra arguments for gradlew')
  .option('--skip-bundle', 'do not rebuild the embedded bundle first')
  .action((options) => {
    runApk(options).catch(fail);
  });

program
  .command('doctor')
  .description('verify the host project is ready to receive OTA updates')
  .option('-r, --project-root <dir>', 'host app directory', process.cwd())
  .action((options) => {
    runDoctor(options).catch(fail);
  });

program.parseAsync(process.argv).catch(fail);

function fail(error) {
  process.exitCode = 1;
  process.stderr.write(`\nota-client: ${(error && error.message) || error}\n`);

  if (process.env.OTA_CLIENT_DEBUG && error && error.stack) {
    process.stderr.write(`${error.stack}\n`);
  }
}
