/**
 * Migrates every report out of Supabase (or a JSON export) into Neon.
 *
 *   npm run db:migrate -- --from-supabase [--dry-run]
 *   npm run db:migrate -- --from-postgres [--dry-run]     (SUPABASE_DB_URL)
 *   npm run db:migrate -- --file supabase-reports.json [--dry-run]
 *
 * The target tables are normalised (reports / employees / attendance), so the
 * JSONB blob is split into rows. Re-running is idempotent: a report for a
 * period that already exists is replaced.
 */
import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { closePool, DatabaseNotConfiguredError, getDb } from '../server/db';
import { saveReport } from '../server/repo';
import {
  describeConfigGap,
  MigrationRowError,
  normaliseRow,
  rowsFromExport,
  toParsedRow,
  type RawRow,
} from './migrate-core';

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const valueOf = (flag: string) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

const dryRun = has('--dry-run');
const fromSupabase = has('--from-supabase');
const fromPostgres = has('--from-postgres');
const file = valueOf('--file');

const USAGE = `Usage:
  npm run db:migrate -- --from-supabase [--dry-run]
  npm run db:migrate -- --from-postgres [--dry-run]
  npm run db:migrate -- --file <path-to-json> [--dry-run]`;

if (!fromSupabase && !fromPostgres && !file) {
  console.error(USAGE);
  process.exit(2);
}

/** Reads the dotenv files so we can explain *why* a variable is missing. */
function envFiles(): Array<{ path: string; text: string }> {
  return ['.env.local', '.env']
    .filter((name) => existsSync(join(process.cwd(), name)))
    .map((name) => ({ path: name, text: readFileSync(join(process.cwd(), name), 'utf8') }));
}

function failConfig(): never {
  console.error('\n  Cannot import from Supabase — credentials are missing.\n');
  for (const line of describeConfigGap(envFiles())) console.error(line);
  console.error('');
  process.exit(1);
}

async function fetchSupabaseRows(): Promise<RawRow[]> {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) failConfig();

  const pageSize = 200;
  const rows: RawRow[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const url =
      `${base}/rest/v1/reports?select=*` +
      `&order=createdAt.asc&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { apikey: key!, Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });

    if (res.status === 401 || res.status === 403) {
      console.error('\n  Supabase rejected the credentials (HTTP ' + res.status + ').\n');
      console.error('  - SUPABASE_SERVICE_ROLE_KEY must be the *service_role* secret, not the anon key.');
      console.error('  - SUPABASE_URL must be the project URL (https://<ref>.supabase.co), no trailing slash.');
      console.error('  - If the table is not called "reports", export it manually (see MIGRATION.md).\n');
      process.exit(1);
    }
    if (!res.ok) {
      throw new Error(`Supabase responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    const batch = ((await res.json()) as Array<Record<string, unknown>>).map(normaliseRow);
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  return rows;
}

/** Fallback for people who have the Postgres connection string but no API keys. */
async function fetchPostgresRows(): Promise<RawRow[]> {
  const connectionString = process.env.SUPABASE_DB_URL || process.env.SUPABASE_DATABASE_URL;
  if (!connectionString) {
    console.error('\n  --from-postgres needs SUPABASE_DB_URL.\n');
    console.error('  Supabase dashboard -> Connect -> the connection string for this project.');
    console.error('  Alternatively use --from-supabase or --file (see MIGRATION.md).\n');
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString,
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const { rows } = await client.query<Record<string, unknown>>('select * from reports');
    return rows.map(normaliseRow);
  } finally {
    await client.end();
  }
}

let sourceRows: RawRow[];
if (file) {
  sourceRows = rowsFromExport(JSON.parse(await readFile(file, 'utf8')));
} else if (fromPostgres) {
  sourceRows = await fetchPostgresRows();
} else {
  sourceRows = await fetchSupabaseRows();
}

console.log(`Found ${sourceRows.length} report(s) to migrate.`);
if (sourceRows.length === 0) {
  console.log('\nNothing to import. If you expected rows, check the "reports" table in Supabase.');
}

let db: ReturnType<typeof getDb> | null = null;
if (!dryRun) {
  try {
    db = getDb();
  } catch (err) {
    if (err instanceof DatabaseNotConfiguredError) {
      console.error('\n  DATABASE_URL is not set — nothing to import into.\n');
      console.error('  Add the Neon pooled connection string to .env.local (see README section 1),');
      console.error('  or re-run with --dry-run to validate the export without a database.\n');
      process.exit(1);
    }
    throw err;
  }
}

let ok = 0;
const failures: Array<{ row: number; error: string }> = [];

for (const [index, raw] of sourceRows.entries()) {
  const label = `${raw.period ?? raw.createdAt ?? 'unknown'} (${raw.fileName ?? raw.file_name ?? 'no name'})`;
  try {
    const parsed = toParsedRow(raw);
    if (db) {
      const result = await saveReport(db, { ...parsed, source: 'migration' });
      console.log(`  ✓ ${parsed.period}  ${parsed.records.length} records  ${result.replaced ? '(replaced)' : ''}`);
    } else {
      console.log(`  ✓ ${parsed.period}  ${parsed.records.length} records  (dry run)`);
    }
    ok += 1;
  } catch (err) {
    if (err instanceof MigrationRowError || err instanceof Error) {
      const message = err.message;
      failures.push({ row: index, error: `${label}: ${message}` });
      console.error(`  ✗ ${label}: ${message}`);
      continue;
    }
    throw err;
  }
}

console.log(`\nMigrated ${ok}/${sourceRows.length} report(s).`);
if (failures.length > 0) {
  console.error(`\n${failures.length} row(s) skipped:`);
  for (const failure of failures) console.error(` - ${failure.error}`);
}

if (db) await closePool();
process.exit(failures.length > 0 ? 1 : 0);
