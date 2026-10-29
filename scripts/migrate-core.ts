/**
 * Pure helpers for the Supabase → Neon import, kept separate from the CLI so
 * they can be unit-tested without touching a network or a database.
 */
import type { EmployeeRecord } from '../src/types';

export interface RawRow {
  id?: string | number;
  fileName?: string;
  file_name?: string;
  period?: string;
  createdAt?: string;
  created_at?: string;
  data?: unknown;
}

export interface ParsedRow {
  fileName: string;
  period: string;
  records: EmployeeRecord[];
  attendanceColumns: string[];
  createdAt?: string;
}

export class MigrationRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationRowError';
  }
}

const PERIOD_RE = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

/** Picks the first present key from a record, case/underscore-insensitively. */
export function pick(record: Record<string, unknown>, names: string[]): unknown {
  const index = new Map<string, unknown>();
  for (const [key, value] of Object.entries(record)) {
    index.set(key.replace(/[_-]/g, '').toLowerCase(), value);
  }
  for (const name of names) {
    const value = index.get(name.replace(/[_-]/g, '').toLowerCase());
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Accepts rows from PostgREST, a JSON export, or straight out of Postgres and
 * produces the canonical shape. Tolerates `fileName` / `file_name` / `filename`
 * and `createdAt` / `created_at` / `createdat`.
 */
export function normaliseRow(raw: Record<string, unknown>): RawRow {
  const id = pick(raw, ['id']);
  const fileName = pick(raw, ['fileName', 'file_name', 'filename', 'name']);
  const period = pick(raw, ['period']);
  const createdAt = pick(raw, ['createdAt', 'created_at', 'createdat', 'inserted_at']);
  const data = pick(raw, ['data', 'report', 'payload', 'json']);

  return {
    id: id as string | number | undefined,
    fileName: fileName == null ? undefined : String(fileName),
    file_name: undefined,
    period: period == null ? undefined : String(period),
    createdAt: createdAt == null ? undefined : String(createdAt),
    created_at: undefined,
    data,
  };
}

/** Accepts `[...]`, `{ reports: [...] }` or `{ rows: [...] }`. */
export function rowsFromExport(parsed: unknown): RawRow[] {
  const candidate = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? (parsed as { reports?: unknown; rows?: unknown }).reports ??
        (parsed as { rows?: unknown }).rows
      : undefined;

  if (!Array.isArray(candidate)) {
    throw new MigrationRowError(
      'JSON file must contain an array of reports (or { "reports": [...] }).',
    );
  }
  return candidate.map((row) => normaliseRow((row ?? {}) as Record<string, unknown>));
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

/** Converts one stored row into what `saveReport` expects. */
export function toParsedRow(raw: RawRow): ParsedRow {
  const payload = parseJson(raw.data) as {
    records?: EmployeeRecord[];
    attendanceColumns?: string[];
    fileName?: string;
  } | null;

  if (!payload || !Array.isArray(payload.records)) {
    throw new MigrationRowError('row has no data.records array');
  }

  const period = raw.period ?? String(raw.createdAt ?? raw.created_at ?? '').slice(0, 7);
  if (!PERIOD_RE.test(period)) {
    throw new MigrationRowError(`row has an unusable period (${JSON.stringify(raw.period)})`);
  }

  return {
    fileName: raw.fileName ?? raw.file_name ?? payload.fileName ?? 'unknown.xlsx',
    period,
    records: payload.records,
    attendanceColumns: Array.isArray(payload.attendanceColumns) ? payload.attendanceColumns : [],
    createdAt: raw.createdAt ?? raw.created_at,
  };
}

/**
 * Explains which env names the import needs, and spots the most common
 * mistake: the variables are present in .env.local but still commented out
 * (that is how `.env.example` ships them).
 */
export function describeConfigGap(envFiles: Array<{ path: string; text: string }>): string[] {
  const lines: string[] = [];
  const mentioned = envFiles.filter((f) => /SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY/.test(f.text));

  if (mentioned.length === 0) {
    lines.push(
      '  No SUPABASE_* variables found. Add both of these to .env.local:',
      '',
      '    SUPABASE_URL=https://<project-ref>.supabase.co',
      '    SUPABASE_SERVICE_ROLE_KEY=<service_role secret>',
    );
  } else {
    const commentsOnly = mentioned.every((f) =>
      f.text
        .split(/\r?\n/)
        .filter((line) => /SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY/.test(line))
        .every((line) => /^\s*#/.test(line)),
    );
    lines.push(
      commentsOnly
        ? `  The variables are in ${mentioned.map((f) => f.path).join(', ')} but still commented out.`
        : `  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are empty in ${mentioned.map((f) => f.path).join(', ')}.`,
      '',
      '  Uncomment them (remove the leading #) and fill in both values, for example:',
      '',
      '    SUPABASE_URL=https://<project-ref>.supabase.co',
      '    SUPABASE_SERVICE_ROLE_KEY=<service_role secret>',
    );
  }

  lines.push(
    '',
    '  Find them in the Supabase dashboard: Project Settings -> API',
    '    - "Project URL"       -> SUPABASE_URL',
    '    - "service_role" key  -> SUPABASE_SERVICE_ROLE_KEY (keep it secret)',
    '',
    '  These are only read by this one-off import; the app itself uses Neon.',
    '  No dashboard access? Export the table by hand instead (see MIGRATION.md):',
    '    npm run db:migrate -- --file supabase-reports.json --dry-run',
  );

  return lines;
}
