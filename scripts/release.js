'use strict';

/**
 * Releases the current version from this machine: no CI needed.
 *
 *   npm run release              publish to npm, tag v<version>, create the GitHub release
 *   npm run release -- --dry-run run every check and `npm publish --dry-run`, change nothing
 *
 * Before running: bump "version" in package.json (and LIBRARY_VERSION in
 * android/build.gradle when the file has it), date the CHANGELOG entry
 * (`## [x.y.z] - YYYY-MM-DD`), commit and push.
 *
 * Needs `npm login` (or an access token in ~/.npmrc) and `gh auth login`.
 * Each step is skipped when already done, so a failed run can be re-run.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');
const isWindows = process.platform === 'win32';

function run(command, args, { capture = false, allowFail = false } = {}) {
  const options = { cwd: root, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8' };
  // npm is a .cmd script on Windows, which only starts through a shell; the
  // shell gets one quoted command line rather than an argument list.
  const result =
    isWindows && command === 'npm'
      ? spawnSync([command, ...args.map((arg) => (/[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg))].join(' '), { ...options, shell: true })
      : spawnSync(command, args, options);

  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFail) {
    throw new Error(`${command} ${args.join(' ')} failed${capture ? `:\n${result.stderr || result.stdout}` : ''}`);
  }

  return { ok: result.status === 0, out: (result.stdout || '').trim() };
}

function step(message) {
  process.stdout.write(`\n> ${message}\n`);
}

function fail(message) {
  process.stderr.write(`\nrelease: ${message}\n`);
  process.exit(1);
}

function changelogSection(version) {
  const file = path.join(root, 'CHANGELOG.md');
  if (!fs.existsSync(file)) fail('CHANGELOG.md not found');

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start === -1) fail(`CHANGELOG.md has no "## [${version}]" entry`);
  if (!/ - \d{4}-\d{2}-\d{2}\s*$/.test(lines[start])) {
    fail(`date the CHANGELOG entry first: "## [${version}] - YYYY-MM-DD" (found "${lines[start]}")`);
  }

  const end = lines.findIndex((line, index) => index > start && line.startsWith('## ['));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim();
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const { name, version } = pkg;
  const tag = `v${version}`;
  const distTag = version.includes('-') ? 'next' : 'latest';

  process.stdout.write(`Releasing ${name}@${version} (npm tag "${distTag}")${dryRun ? ' — dry run' : ''}\n`);

  step('Checking the repository');
  if (run('git', ['status', '--porcelain'], { capture: true }).out) {
    fail('the working tree has uncommitted changes; commit or stash them first');
  }
  const branch = run('git', ['branch', '--show-current'], { capture: true }).out;
  if (branch !== 'main') fail(`release from main (current branch: ${branch || 'detached'})`);
  run('git', ['fetch', '--quiet', 'origin', 'main']);
  const local = run('git', ['rev-parse', 'HEAD'], { capture: true }).out;
  const remote = run('git', ['rev-parse', 'origin/main'], { capture: true }).out;
  if (local !== remote) fail('main is not the same as origin/main; push or pull first');

  step('Checking versions');
  const notes = changelogSection(version);
  const gradle = path.join(root, 'android', 'build.gradle');
  const match = fs.existsSync(gradle) && fs.readFileSync(gradle, 'utf8').match(/LIBRARY_VERSION",\s*"\\"([^"\\]+)\\""/);
  if (match && match[1] !== version) {
    fail(`LIBRARY_VERSION in android/build.gradle is ${match[1]}, package.json is ${version}`);
  }
  process.stdout.write(`package.json, CHANGELOG${match ? ' and LIBRARY_VERSION' : ''} agree on ${version}\n`);

  step('Checking accounts');
  const npmUser = run('npm', ['whoami'], { capture: true, allowFail: true });
  if (!npmUser.ok) fail('not logged in to npm: run `npm login` or add a token to ~/.npmrc');
  process.stdout.write(`npm: ${npmUser.out}\n`);
  if (!run('gh', ['auth', 'status'], { capture: true, allowFail: true }).ok) {
    fail('not logged in to GitHub: run `gh auth login`');
  }
  process.stdout.write('gh: logged in\n');

  // 1. npm. `prepublishOnly` typechecks (and tests) and `prepare` builds dist/.
  const published = run('npm', ['view', `${name}@${version}`, 'version'], { capture: true, allowFail: true }).out === version;
  if (published) {
    step(`${name}@${version} is already on npm; skipping publish`);
  } else {
    step(`Publishing ${name}@${version} to npm`);
    const args = ['publish', '--access', 'public', '--tag', distTag];
    if (dryRun) args.push('--dry-run');
    run('npm', args); // inherits the terminal, so npm can ask for a one-time password
  }

  const tagExists = run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], { capture: true }).out !== '';
  const releaseExists = run('gh', ['release', 'view', tag], { capture: true, allowFail: true }).ok;

  if (dryRun) {
    step(
      'Dry run done. A real run would also: ' +
        `${tagExists ? `keep the existing tag ${tag}` : `push the tag ${tag}`}, ` +
        `${releaseExists ? 'keep the existing GitHub release' : 'create the GitHub release'}.`,
    );
    return;
  }

  // 2. Git tag.
  if (tagExists) {
    step(`Tag ${tag} is already on GitHub; skipping`);
  } else {
    step(`Tagging ${tag}`);
    if (!run('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], { capture: true, allowFail: true }).ok) {
      run('git', ['tag', '-a', tag, '-m', `${name} ${version}`]);
    }
    run('git', ['push', 'origin', tag]);
  }

  // 3. GitHub release, with the CHANGELOG entry as its notes.
  if (releaseExists) {
    step(`GitHub release ${tag} already exists; skipping`);
  } else {
    step(`Creating the GitHub release ${tag}`);
    const notesFile = path.join(os.tmpdir(), `${name}-${version}-notes.md`);
    fs.writeFileSync(notesFile, `${notes}\n`);
    const args = ['release', 'create', tag, '--verify-tag', '--title', version, '--notes-file', notesFile];
    if (distTag === 'next') args.push('--prerelease');
    try {
      run('gh', args);
    } finally {
      fs.rmSync(notesFile, { force: true });
    }
  }

  step(`Released ${name}@${version}`);
}

try {
  main();
} catch (error) {
  fail(error.message);
}
