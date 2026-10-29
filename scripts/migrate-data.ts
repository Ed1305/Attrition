/**
 * Migrates every report out of Supabase (or a JSON export) into Neon.
 *
 *   npm run db:migrate -- --from-supabase
 *   npm run db:migrate -- --file supabase-reports.json
 *   npm run db:migrate -- --from-supabase --dry-run
 *
 * The target tables are normalised (reports / employees / attendance), so the
 * JSONB blob is split into rows. Re-running is idempotent: a report for a
 * period that already exists is replaced.
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { closePool, getDb } from '../server/db';
import { saveReport, ValidationError } from '../server/repo';
import type { EmployeeRecord } from '../src/types';

interface RawRow {
  id?: string | number;
  fileName?: string;
  file_name?: string;
  period?: string;
  createdAt?: string;
  created_at?: string;
  data?: unknown;
}

interface ParsedRow {
  fileName: string;
  period: string;
  records: EmployeeRecord[];
  attendanceColumns: string[];
  createdAt?: string;
}

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const valueOf = (flag: string) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

const dryRun = has('--dry-run');
const fromSupabase = has('--from-supabase');
const file = valueOf('--file');

if (!fromSupabase && !file) {
  console.error(
    'Usage:\n  npm run db:migrate -- --from-supabase [--dry-run]\n  npm run db:migrate -- --file <path-to-json> [--dry-run]',
  );
  process.exit(2);
}

async function fetchSupabaseRows(): Promise<RawRow[]> {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to migrate from Supabase.');
  }

  // The legacy app quoted camelCase columns, but tolerate snake_case too.
  const columns = ['id', 'fileName', 'file_name', 'period', 'data', 'createdAt', 'created_at'].join(',');
  const pageSize = 200;
  const rows: RawRow[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const url = `${base}/rest/v1/reports?select=${columns}&order=createdAt.asc&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`Supabase responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const batch = (await res.json()) as RawRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  return rows;
}

function parseJson(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function toParsedRow(raw: RawRow): ParsedRow {
  const payload = parseJson(raw.data) as { records?: EmployeeRecord[]; attendanceColumns?: string[]; fileName?: string } | null;
  if (!payload || !Array.isArray(payload.records)) {
    throw new ValidationError('row has no data.records array');
  }

  const period = raw.period ?? (raw.createdAt ?? raw.created_at ?? '').slice(0, 7);
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new ValidationError(`row has an unusable period (${JSON.stringify(raw.period)})`);
  }

  return {
    fileName: raw.fileName ?? raw.file_name ?? payload.fileName ?? 'unknown.xlsx',
    period,
    records: payload.records,
    attendanceColumns: Array.isArray(payload.attendanceColumns) ? payload.attendanceColumns : [],
    createdAt: raw.createdAt ?? raw.created_at,
  };
}

let sourceRows: RawRow[];
if (file) {
  const parsed = JSON.parse(await readFile(file, 'utf8'));
  sourceRows = Array.isArray(parsed) ? parsed : parsed.reports ?? parsed.rows ?? [];
  if (!Array.isArray(sourceRows)) throw new Error('JSON file must contain an array of reports');
} else {
  sourceRows = await fetchSupabaseRows();
}

console.log(`Found ${sourceRows.length} report(s) to migrate.`);

const db = dryRun ? null : getDb();
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
    const message = err instanceof Error ? err.message : String(err);
    failures.push({ row: index, error: `${label}: ${message}` });
    console.error(`  ✗ ${label}: ${message}`);
  }
}

console.log(`\nMigrated ${ok}/${sourceRows.length} report(s).`);
if (failures.length > 0) {
  console.error(`\n${failures.length} row(s) skipped:`);
  for (const failure of failures) console.error(` - ${failure.error}`);
}

if (db) await closePool();
process.exit(failures.length > 0 ? 1 : 0);
