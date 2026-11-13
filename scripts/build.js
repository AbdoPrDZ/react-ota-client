'use strict';

/**
 * Builds the publishable package into dist/:
 *
 *   dist/index.js       runtime (src/), one minified CommonJS bundle
 *   dist/cli/index.js   CLI, minified, with its shebang
 *   dist/types/         .d.ts declarations (the public API only)
 *
 * The JavaScript is minified and mangled on purpose: what ships is not the
 * readable source. No source maps are emitted, since they would undo that.
 * The Kotlin engine (android/) ships as source: the host app compiles it.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const pkg = require(path.join(root, 'package.json'));

/** Never bundled: provided by the app (peers) or installed with the package (dependencies). */
const external = [
  ...Object.keys(pkg.peerDependencies || {}),
  ...Object.keys(pkg.dependencies || {}),
  'react/*',
  'react-native/*',
];

const common = {
  bundle: true,
  minify: true,
  keepNames: false,
  legalComments: 'none',
  sourcemap: false,
  format: 'cjs',
  logLevel: 'warning',
  external,
  define: { 'process.env.NODE_ENV': '"production"' },
};

async function build() {
  fs.rmSync(dist, { recursive: true, force: true });

  // Runtime. `__DEV__` stays a free variable: React Native defines it per build.
  await esbuild.build({
    ...common,
    entryPoints: [path.join(root, 'src', 'index.ts')],
    outfile: path.join(dist, 'index.js'),
    platform: 'neutral',
    mainFields: ['react-native', 'main'],
    target: 'es2020',
    jsx: 'automatic',
  });

  // CLI: the source keeps its shebang, esbuild preserves it.
  await esbuild.build({
    ...common,
    entryPoints: [path.join(root, 'cli', 'index.js')],
    outfile: path.join(dist, 'cli', 'index.js'),
    platform: 'node',
    target: 'node18',
  });
  fs.chmodSync(path.join(dist, 'cli', 'index.js'), 0o755);

  // Declarations: the only readable output, needed by editors and TypeScript.
  const tsc = require.resolve('typescript/bin/tsc');
  execFileSync(process.execPath, [tsc, '-p', path.join(root, 'tsconfig.build.json')], { stdio: 'inherit' });

  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(`${path.relative(root, full).split(path.sep).join('/')} (${fs.statSync(full).size} B)`);
    }
  })(dist);

  console.log(`Built ${files.length} files:\n  ${files.join('\n  ')}`);
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
