import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readdir, rm } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import { createApiHandler, restoreApiPath } from '../server/handler.ts';

/**
 * Regression coverage for the deployment wiring that broke production:
 *
 *  1. The lambda crashed on load (`FUNCTION_INVOCATION_FAILED` → HTTP 500 on
 *     every /api route) because `api/index.ts` and `server/app.ts` used
 *     extension-less relative imports. Node runs the emitted function as ESM
 *     (`"type": "module"`), so the specifiers must carry a file extension or
 *     the module graph never resolves.
 *  2. Vercel routes every /api/* request to the single `api/index.ts` function
 *     through a rewrite, which may present the original path, the destination
 *     path, or the path carried in `__path`. All shapes must reach Express as
 *     /api/...
 */

const ROOT = new URL('../', import.meta.url);
const execFileAsync = promisify(execFileCb);

let server: ReturnType<typeof createServer>;
let baseUrl: string;

before(async () => {
  // No DATABASE_URL in the test environment: the repository-backed routes
  // answer 503 while health/admin-session still answer, which is exactly what
  // we need to prove the request reached the Express router.
  server = createServer(createApiHandler());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('restoreApiPath', () => {
  it('keeps an already-api-prefixed URL untouched', () => {
    assert.equal(restoreApiPath('/api/health'), '/api/health');
    assert.equal(restoreApiPath('/api/reports?limit=5'), '/api/reports?limit=5');
    assert.equal(restoreApiPath('/api'), '/api');
  });

  it('rebuilds the path carried by the rewrite in __path', () => {
    assert.equal(restoreApiPath('/api?__path=/health'), '/api/health');
    assert.equal(restoreApiPath('/api?__path=/reports/abc'), '/api/reports/abc');
    assert.equal(restoreApiPath('/api?__path='), '/api');
    // trailing slashes from the capture group are collapsed
    assert.equal(restoreApiPath('/api?__path=/'), '/api');
  });

  it('merges the real query string alongside __path', () => {
    assert.equal(restoreApiPath('/api?__path=/reports&limit=5'), '/api/reports?limit=5');
    assert.equal(
      restoreApiPath('/api?__path=/reports/abc&limit=5&offset=10'),
      '/api/reports/abc?limit=5&offset=10',
    );
    assert.equal(restoreApiPath('/api?__path=/x&a=1&b=2'), '/api/x?a=1&b=2');
  });

  it('prefixes a URL whose /api prefix was stripped', () => {
    assert.equal(restoreApiPath('/health'), '/api/health');
    assert.equal(restoreApiPath('/reports/abc?limit=1'), '/api/reports/abc?limit=1');
    assert.equal(restoreApiPath('/'), '/api');
    assert.equal(restoreApiPath(undefined), '/api');
  });
});

describe('api handler (rewritten production URLs)', () => {
  async function get(path: string) {
    const res = await fetch(`${baseUrl}${path}`);
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text };
  }

  const healthShapes = [
    '/api/health', // original path preserved
    '/api?__path=/health', // destination path with __path
    '/api?__path=/health&probe=1', // __path plus real query
    '/health', // prefix stripped
  ];

  for (const shape of healthShapes) {
    it(`serves health for ${shape}`, async () => {
      const { status, json } = await get(shape);
      // 503 without DATABASE_URL, 200 with it — either way it is our JSON.
      assert.ok(status === 200 || status === 503, `unexpected status ${status}`);
      assert.equal(json?.storage, 'neon');
      assert.equal(typeof json?.database?.connected, 'boolean');
    });
  }

  it('routes admin session through the rewrite (not the SPA fallback)', async () => {
    for (const shape of ['/api/admin/session', '/api?__path=/admin/session', '/admin/session']) {
      const { status, json } = await get(shape);
      assert.equal(status, 200, `${shape} → ${status}`);
      assert.equal(json?.authenticated, false, shape);
    }
  });

  it('keeps repository routes on the API (503 without a database, never 500)', async () => {
    for (const shape of ['/api/reports', '/api?__path=/reports', '/reports']) {
      const { status } = await get(shape);
      assert.equal(status, 503, `${shape} → ${status}`);
    }
  });

  it('still rejects unknown /api paths with JSON 404', async () => {
    const { status } = await get('/api?__path=/nope');
    assert.equal(status, 404);
  });
});

describe('deployment configuration', () => {
  it('keeps the generated api/index.js in sync with server/handler.ts', async () => {
    // Vercel compiles nothing for us: the deployed function IS this bundle, so
    // a stale artifact silently ships old server code.
    const tmp = new URL('../api/index.js.tmp', import.meta.url);
    const { stdout } = await execFileAsync(process.execPath, [
      new URL('../scripts/build-api.mjs', import.meta.url).pathname,
      '--outfile',
      tmp.pathname,
    ]);
    const [generated, committed] = await Promise.all([
      readFile(tmp, 'utf8'),
      readFile(new URL('../api/index.js', import.meta.url), 'utf8'),
    ]);
    await rm(tmp);
    assert.equal(
      generated,
      committed,
      `api/index.js is out of date — run \`npm run build:api\` (${stdout.trim()})`,
    );
  });


  it('routes every /api/* request to the single function, carrying the path', async () => {
    const config = JSON.parse(await readFile(new URL('vercel.json', ROOT), 'utf8'));
    assert.equal(config.rewrites[0].source, '/api/(.*)');
    assert.equal(config.rewrites[0].destination, '/api?__path=/$1');
    assert.equal(config.rewrites.at(-1).destination, '/index.html');
  });

  it('uses explicit .ts extensions for relative imports run by Node', async () => {
    const dirs = ['api', 'server'];
    const offenders: string[] = [];
    for (const dir of dirs) {
      for (const file of await readdir(new URL(`${dir}/`, ROOT))) {
        if (!file.endsWith('.ts')) continue;
        const source = await readFile(new URL(`${dir}/${file}`, ROOT), 'utf8');
        for (const match of source.matchAll(/from\s+'(\.[^']*)'/g)) {
          const specifier = match[1];
          if (!/\.(ts|js|mjs|cjs|json)$/.test(specifier)) {
            offenders.push(`${dir}/${file} → ${specifier}`);
          }
        }
      }
    }
    assert.deepEqual(offenders, [], 'extension-less relative imports break the ESM lambda');
  });
});
