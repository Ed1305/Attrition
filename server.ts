import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './server/app';
import { closePool } from './server/db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';

async function main() {
  const app = createApp();

  if (!process.env.DATABASE_URL) {
    console.warn(
      '[startup] DATABASE_URL is not set — the API will answer 503 for all data routes.\n' +
        '          Copy .env.example to .env.local and paste your Neon connection string.',
    );
  }
  if (!process.env.ADMIN_PASSCODE) {
    console.warn('[startup] ADMIN_PASSCODE is not set — uploading/saving/deleting is disabled.');
  }

  if (!isProduction) {
    // vite is a devDependency: load it lazily so a production bundle never
    // touches it (the previous build imported vite at module scope).
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const dist = path.join(__dirname, 'dist');
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  const port = Number(process.env.PORT ?? 3000);
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Attrition running on http://localhost:${port} (${isProduction ? 'production' : 'development'})`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received — shutting down.`);
    server.close();
    await closePool().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[startup] fatal:', err);
  process.exit(1);
});
