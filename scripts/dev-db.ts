/**
 * Local Postgres for development without a Neon account.
 *
 *   npm run dev:db          # terminal 1 — Postgres wire server on :55432
 *   DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres npm run db:setup
 *   DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres npm run dev
 *
 * This is PGlite (Postgres 17 compiled to WASM) behind a socket server. It is
 * for local work only — production must point DATABASE_URL at Neon.
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const port = Number(process.env.PGLITE_PORT ?? 55432);
const dataDir = process.env.PGLITE_DATA_DIR; // unset => in-memory

const db = dataDir ? await PGlite.create(dataDir) : await PGlite.create();
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
await server.start();

console.log(`PGlite listening on 127.0.0.1:${port} (${dataDir ?? 'in-memory'})`);
console.log(`DATABASE_URL=postgres://postgres:postgres@127.0.0.1:${port}/postgres`);

const shutdown = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
