import pg from 'pg';

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
