import pg from 'pg';
import { SCHEMA_SQL } from './schema.ts';

/**
 * Minimal database interface so the repository layer can run against
 * node-postgres (Neon / local Postgres) and against PGlite in tests.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs a multi-statement script (schema setup). No parameters. */
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super(
      'DATABASE_URL is not set. Point it at your Neon connection string, e.g. ' +
        'postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require',
    );
    this.name = 'DatabaseNotConfiguredError';
  }
}

class PgDb implements Db {
  /** `owner` is set only on the root instance; transaction-scoped instances omit it. */
  constructor(
    private readonly executor: { query(sql: string, params?: unknown[]): Promise<pg.QueryResult> },
    private readonly owner: pg.Pool | null = null,
  ) {}

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    // Root instance only: make sure the schema exists before the first query
    // runs, so a fresh Neon database works without a manual setup step.
    if (this.owner) await ensureSchema();
    const result = await this.executor.query(sql, params);
    return result.rows as T[];
  }

  async exec(sql: string): Promise<void> {
    // No values => node-postgres uses the simple query protocol, which allows
    // multiple statements in a single call (schema setup).
    await this.executor.query(sql);
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    // Already inside a transaction: reuse the same connection.
    if (!this.owner) return fn(this);

    const conn = await this.owner.connect();
    try {
      const scoped = new PgDb(conn);
      await conn.query('begin');
      const result = await fn(scoped);
      await conn.query('commit');
      return result;
    } catch (err) {
      await conn.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      conn.release();
    }
  }
}

let pool: pg.Pool | null = null;

/**
 * Neons pooled connection string is recommended (`-pooler` host) because
 * serverless functions each hold their own small pool.
 */
export function getPool(): pg.Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new DatabaseNotConfiguredError();

  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
  pool = new pg.Pool({
    connectionString,
    max: Number(process.env.PGPOOL_MAX ?? 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: isLocal || /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false },
  });
  // A pool error must never take the process down (Neon recycles connections).
  pool.on('error', (err: Error) => console.error('[db] idle client error:', err.message));
  return pool;
}

export function getDb(): Db {
  return new PgDb(getPool(), getPool());
}

let schemaReady: Promise<void> | null = null;

/**
 * Applies the (idempotent) schema once per process.
 *
 * Serverless deployments have no build step that can reach the database, so a
 * brand new Neon project would otherwise answer every request with
 * `relation "reports" does not exist`. Failures are logged rather than thrown:
 * if the role cannot run DDL but the schema already exists, queries must still
 * work. Errors reset the memo so the next request retries.
 */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = getPool()
      .query(SCHEMA_SQL)
      .then(() => undefined)
      .catch((err: unknown) => {
        schemaReady = null;
        console.error('[db] schema ensure failed:', err instanceof Error ? err.message : err);
      });
  }
  return schemaReady;
}

/** Cheap liveness probe used by /api/health. */
export async function pingDatabase(): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = getDb();
    await db.query('select 1');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.end();
}
