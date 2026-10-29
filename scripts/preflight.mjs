/**
 * Pre-flight check run by the npm lifecycle hooks (predev, predb:setup, …).
 *
 * Plain JavaScript with no imports on purpose: it has to run even when
 * node_modules is missing or half-installed, which is exactly when npm's
 * "…is not recognized as an internal or external command" appears.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const isWindows = process.platform === 'win32';
const bin = (name) => join(root, 'node_modules', '.bin', isWindows ? `${name}.cmd` : name);

// `build` only needs vite (a runtime dependency), so a production-only install
// can still deploy; everything else is executed through tsx.
const script = process.env.npm_lifecycle_event ?? '';
const needed = script === 'build' ? ['vite'] : ['tsx'];
const required = needed.filter((name) => !existsSync(bin(name)));

const fail = (lines) => {
  console.error('\n  Cannot start: this project has not been installed correctly.\n');
  for (const line of lines) console.error(`  ${line}`);
  console.error('');
  process.exit(1);
};

// 1. Node version (Vite 6 / tsx 4 need 20+; Neon + pg need 18+, but 20+ is what CI uses).
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  fail([
    `Node ${process.versions.node} is too old — Node 20 or newer is required.`,
    'Download it from https://nodejs.org (LTS).',
  ]);
}

// 2. Dependencies.
if (required.length > 0) {
  const lines = [
    `Missing: ${required.join(', ')} (npm never created node_modules/.bin).`,
    '',
    'Fix it with a clean install:',
  ];

  if (existsSync(join(root, 'node_modules', 'better-sqlite3'))) {
    lines.push(
      '',
      '  node_modules still contains better-sqlite3, from the pre-Neon version of',
      '  this project. That native module needed a C++ toolchain, so the old',
      '  npm install failed part-way and left this tree broken.',
      '',
      '  Remove it first, then reinstall:',
      isWindows
        ? '    rmdir /s /q node_modules    (PowerShell: Remove-Item -Recurse -Force node_modules)'
        : '    rm -rf node_modules',
    );
  } else {
    lines.push(isWindows
      ? '    rmdir /s /q node_modules    (PowerShell: Remove-Item -Recurse -Force node_modules)'
      : '    rm -rf node_modules');
  }

  lines.push('    npm ci', '', 'Then re-run this command.');
  fail(lines);
}

// 3. Environment hints (warnings only — never block on these).
const envFile = ['.env.local', '.env'].map((file) => join(root, file)).find(existsSync);
const envText = envFile ? readFileSync(envFile, 'utf8') : '';
const has = (key) => Boolean(process.env[key]) || new RegExp(`^${key}=\\S`, 'm').test(envText);

const needsDb = script.includes('db:') || script === 'dev' || script === 'start';

if (needsDb && !has('DATABASE_URL')) {
  console.warn(
    '\n  ! DATABASE_URL is not set in the environment or .env.local.\n' +
      '    Copy .env.example to .env.local and paste your Neon connection string.\n',
  );
}
if (needsDb && !has('ADMIN_PASSCODE')) {
  console.warn(
    '\n  ! ADMIN_PASSCODE is not set — uploading, saving and deleting will be refused.\n',
  );
}
