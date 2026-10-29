import { randomUUID } from 'node:crypto';
import type { Db } from './db.ts';
import type { EmployeeRecord, ProcessedReport } from '../src/types.ts';

export interface ReportSummary {
  id: string;
  fileName: string;
  period: string;
  source: string;
  createdAt: string;
  records: number;
  active: number;
  awol: number;
  resigned: number;
  droppedOut: number;
  terminated: number;
  inactive: number;
}

export interface TrendPoint {
  period: string;
  records: number;
  active: number;
  inactive: number;
  lastSaved: string;
}

export interface SaveReportInput {
  fileName: string;
  period: string;
  records: EmployeeRecord[];
  attendanceColumns: string[];
  source?: string;
  warnings?: string[];
  /** Preserved when importing historical reports. */
  createdAt?: string | Date;
}

export interface SaveReportResult {
  id: string;
  replaced: boolean;
}

const PERIOD_RE = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

export function assertPeriod(period: string): string {
  if (!PERIOD_RE.test(period)) {
    throw new ValidationError(`Invalid period "${period}" — expected YYYY-MM (e.g. 2026-08).`);
  }
  return period;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Report not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export async function listReports(db: Db): Promise<ReportSummary[]> {
  const rows = await db.query<{
    id: string;
    file_name: string;
    period: string;
    source: string;
    created_at: Date | string;
    records: number;
    active: number;
    awol: number;
    resigned: number;
    dropped_out: number;
    terminated: number;
    inactive: number;
  }>(
    `select id, file_name, period, source, created_at,
            records, active, awol, resigned, dropped_out, terminated, inactive
       from report_overview
      order by period desc, created_at desc`,
  );

  return rows.map((r) => ({
    id: r.id,
    fileName: r.file_name,
    period: r.period,
    source: r.source,
    createdAt: new Date(r.created_at).toISOString(),
    records: Number(r.records),
    active: Number(r.active),
    awol: Number(r.awol),
    resigned: Number(r.resigned),
    droppedOut: Number(r.dropped_out),
    terminated: Number(r.terminated),
    inactive: Number(r.inactive),
  }));
}

export interface StoredReport {
  report: ProcessedReport;
  period: string;
}

/**
 * Rehydrates a stored report into the exact `ProcessedReport` shape the UI has
 * always consumed, so the frontend contract is unchanged by the migration.
 */
export async function getReport(db: Db, id: string): Promise<StoredReport | null> {
  const [report] = await db.query<{
    file_name: string;
    attendance_columns: unknown;
    period: string;
  }>('select file_name, attendance_columns, period from reports where id = $1', [id]);

  if (!report) return null;

  const employees = await db.query<{
    ordinal: number;
    emp_code: string;
    employee_name: string;
    start_date: string | null;
    team: string | null;
    base_team: string | null;
    status: string | null;
    category: string | null;
    based_headcount: string | null;
    end_date: string | null;
    branch: string | null;
  }>(
    `select ordinal, emp_code, employee_name, start_date, team, base_team,
            status, category, based_headcount, end_date, branch
       from employees
      where report_id = $1
      order by ordinal`,
    [id],
  );

  const attendanceRows = await db.query<{ ordinal: number; day_label: string; value: string }>(
    `select e.ordinal, a.day_label, a.value
       from attendance a
       join employees e on e.id = a.employee_id
      where e.report_id = $1
      order by e.ordinal, a.day_label`,
    [id],
  );

  const attendanceByOrdinal = new Map<number, Record<string, number | string>>();
  for (const row of attendanceRows) {
    const bucket = attendanceByOrdinal.get(row.ordinal) ?? {};
    bucket[row.day_label] = numericOrText(row.value);
    attendanceByOrdinal.set(row.ordinal, bucket);
  }

  const records: EmployeeRecord[] = employees.map((e) => ({
    empCode: e.emp_code,
    employeeName: e.employee_name,
    startDate: e.start_date ?? 'N/A',
    team: e.team ?? '',
    baseTeam: e.base_team ?? 'UNASSIGNED',
    status: e.status ?? 'ACTIVE',
    category: (e.category ?? 'OTHER') as EmployeeRecord['category'],
    basedHeadcount: e.based_headcount ?? e.status ?? '',
    endDate: e.end_date ?? 'N/A',
    attendance: attendanceByOrdinal.get(Number(e.ordinal)) ?? {},
    branch: e.branch ?? '',
  }));

  return {
    period: report.period,
    report: {
      fileName: report.file_name,
      attendanceColumns: Array.isArray(report.attendance_columns)
        ? (report.attendance_columns as string[])
        : [],
      records,
    },
  };
}

/** '1' -> 1, '0' -> 0, 'A' -> 'A'; keeps non-numeric attendance codes intact. */
function numericOrText(value: string): number | string {
  if (value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

/**
 * Inserts a report and its rows in one transaction.
 * A report for the same period is replaced (period is unique), which prevents
 * the duplicate-month problem the JSONB/Supabase model allowed.
 */
export async function saveReport(db: Db, input: SaveReportInput): Promise<SaveReportResult> {
  const period = assertPeriod(input.period);
  if (!Array.isArray(input.records) || input.records.length === 0) {
    throw new ValidationError('Report contains no employee records.');
  }
  if (input.records.length > 20_000) {
    throw new ValidationError('Report contains too many records (limit 20,000).');
  }

  const id = randomUUID();
  const columns = Array.isArray(input.attendanceColumns) ? input.attendanceColumns : [];

  // One payload per table; the attendance join matches rows by ordinal, so no
  // round-trip per employee is needed.
  const employeePayload = input.records.map((record, ordinal) => ({
    ordinal,
    emp_code: String(record.empCode ?? ''),
    employee_name: String(record.employeeName ?? ''),
    start_date: record.startDate == null ? null : String(record.startDate),
    team: record.team == null ? null : String(record.team),
    base_team: record.baseTeam == null ? null : String(record.baseTeam),
    status: record.status == null ? null : String(record.status),
    category: normaliseCategory(record.category),
    based_headcount: record.basedHeadcount == null ? null : String(record.basedHeadcount),
    end_date: record.endDate == null ? null : String(record.endDate),
    branch: String(record.branch ?? ''),
  }));

  const attendancePayload: Array<{ ordinal: number; day_label: string; value: string }> = [];
  input.records.forEach((record, ordinal) => {
    for (const [dayLabel, value] of Object.entries(record.attendance ?? {})) {
      attendancePayload.push({ ordinal, day_label: dayLabel, value: String(value) });
    }
  });

  return db.transaction(async (tx) => {
    const existing = await tx.query<{ id: string }>('select id from reports where period = $1', [period]);
    if (existing.length > 0) {
      await tx.query('delete from reports where period = $1', [period]);
    }

    await tx.query(
      `insert into reports
         (id, file_name, period, attendance_columns, record_count, source, warnings, created_at)
       values ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, coalesce($8::timestamptz, now()))`,
      [
        id,
        String(input.fileName ?? 'unknown.xlsx'),
        period,
        JSON.stringify(columns),
        input.records.length,
        input.source ?? 'upload',
        JSON.stringify(input.warnings ?? []),
        input.createdAt ? new Date(input.createdAt).toISOString() : null,
      ],
    );

    await tx.query(
      `insert into employees
         (report_id, ordinal, emp_code, employee_name, start_date, team, base_team,
          status, category, based_headcount, end_date, branch)
       select $1, x.ordinal, coalesce(x.emp_code, ''), coalesce(x.employee_name, ''),
              x.start_date, x.team, x.base_team, x.status, x.category,
              x.based_headcount, x.end_date, coalesce(x.branch, '')
         from jsonb_to_recordset($2::jsonb) as x(
           ordinal integer, emp_code text, employee_name text, start_date text,
           team text, base_team text, status text, category text,
           based_headcount text, end_date text, branch text
         )`,
      [id, JSON.stringify(employeePayload)],
    );

    if (attendancePayload.length > 0) {
      await tx.query(
        `insert into attendance (employee_id, day_label, value)
         select e.id, a.day_label, a.value
           from jsonb_to_recordset($2::jsonb) as a(ordinal integer, day_label text, value text)
           join employees e on e.report_id = $1 and e.ordinal = a.ordinal`,
        [id, JSON.stringify(attendancePayload)],
      );
    }

    return { id, replaced: existing.length > 0 };
  });
}

function normaliseCategory(category: unknown): string {
  const allowed = ['ACTIVE', 'AWOL', 'RESIGNED', 'DROPPED_OUT', 'TERMINATED', 'OTHER'];
  const value = String(category ?? 'OTHER').toUpperCase();
  return allowed.includes(value) ? value : 'OTHER';
}

export async function deleteReport(db: Db, id: string): Promise<void> {
  const rows = await db.query<{ id: string }>('delete from reports where id = $1 returning id', [id]);
  if (rows.length === 0) throw new NotFoundError();
}

export async function purgeReports(db: Db): Promise<number> {
  const rows = await db.query<{ id: string }>('delete from reports returning id');
  return rows.length;
}

export async function getTrends(db: Db): Promise<TrendPoint[]> {
  const rows = await db.query<{
    period: string;
    records: number;
    active: number;
    inactive: number;
    last_saved: Date | string;
  }>('select period, records, active, inactive, last_saved from period_trend');

  return rows.map((r) => ({
    period: r.period,
    records: Number(r.records),
    active: Number(r.active),
    inactive: Number(r.inactive),
    lastSaved: new Date(r.last_saved).toISOString(),
  }));
}
