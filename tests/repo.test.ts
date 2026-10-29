import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { Db } from '../server/db.ts';
import {
  deleteReport,
  getReport,
  getTrends,
  listReports,
  NotFoundError,
  purgeReports,
  saveReport,
  ValidationError,
} from '../server/repo.ts';
import type { EmployeeRecord } from '../src/types.ts';

/**
 * The repository talks to a `Db` interface, so these tests run against a real
 * Postgres engine (PGlite = Postgres compiled to WASM) with the production
 * schema applied — no mocks of the SQL layer.
 */

let pglite: PGlite;
let db: Db;

function pgliteDb(client: PGlite): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const result = await client.query(sql, params as never[]);
      return result.rows as T[];
    },
    async exec(sql: string): Promise<void> {
      await client.exec(sql);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return client.transaction(async (tx) => fn(pgliteDb(tx as unknown as PGlite)));
    },
  };
}

function record(overrides: Partial<EmployeeRecord> = {}): EmployeeRecord {
  return {
    empCode: 'E001',
    employeeName: 'Thandi Mokoena',
    startDate: '12/03/2025',
    team: 'TEAM MOSES',
    baseTeam: 'TEAM MOSES',
    status: 'ACTIVE',
    category: 'ACTIVE',
    basedHeadcount: 'ACTIVE',
    endDate: 'Not Applicable',
    attendance: { 'Wed(26)': 1, 'Thu(27)': 0, 'Fri(28)': 'A' },
    branch: 'INVNT CAPE TOWN',
    ...overrides,
  };
}

before(async () => {
  pglite = new PGlite();
  await pglite.waitReady;
  const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  await pglite.exec(schema);
  db = pgliteDb(pglite);
});

after(async () => {
  await pglite.close();
});

describe('report repository', () => {
  let reportId: string;

  it('saves a report and returns generated id', async () => {
    const result = await saveReport(db, {
      fileName: 'Attrition - August 2026.xlsx',
      period: '2026-08',
      attendanceColumns: ['Wed(26)', 'Thu(27)', 'Fri(28)'],
      records: [
        record(),
        record({
          empCode: 'E002',
          employeeName: 'Sipho Dlamini',
          category: 'RESIGNED',
          status: 'INACTIVE',
          team: 'RESIGNED EMP.',
          endDate: '14/08/2026',
          attendance: {},
        }),
      ],
    });

    assert.match(result.id, /^[0-9a-f-]{36}$/);
    assert.equal(result.replaced, false);
    reportId = result.id;
  });

  it('round-trips the report into the original ProcessedReport shape', async () => {
    const stored = await getReport(db, reportId);
    assert.ok(stored);
    assert.equal(stored.period, '2026-08');
    const report = stored.report;
    assert.equal(report.fileName, 'Attrition - August 2026.xlsx');
    assert.deepEqual(report.attendanceColumns, ['Wed(26)', 'Thu(27)', 'Fri(28)']);
    assert.equal(report.records.length, 2);

    const [active, resigned] = report.records;
    assert.equal(active.empCode, 'E001');
    assert.equal(active.employeeName, 'Thandi Mokoena');
    assert.equal(active.category, 'ACTIVE');
    // numeric values come back as numbers, codes as strings
    assert.deepEqual(active.attendance, { 'Wed(26)': 1, 'Thu(27)': 0, 'Fri(28)': 'A' });
    assert.equal(resigned.category, 'RESIGNED');
    assert.deepEqual(resigned.attendance, {});
    assert.equal(report.records[1].endDate, '14/08/2026');
  });

  it('aggregates counts per period', async () => {
    const summaries = await listReports(db);
    assert.equal(summaries.length, 1);
    assert.deepEqual(
      {
        period: summaries[0].period,
        records: summaries[0].records,
        active: summaries[0].active,
        resigned: summaries[0].resigned,
        inactive: summaries[0].inactive,
      },
      { period: '2026-08', records: 2, active: 1, resigned: 1, inactive: 1 },
    );
  });

  it('returns null for an unknown report', async () => {
    assert.equal(await getReport(db, '00000000-0000-0000-0000-000000000000'), null);
  });

  it('replaces a report when the same period is saved again', async () => {
    const result = await saveReport(db, {
      fileName: 'reworked.xlsx',
      period: '2026-08',
      attendanceColumns: ['Wed(26)'],
      records: [
        record(),
        record({ empCode: 'E003', employeeName: 'Anele Khumalo' }),
        record({ empCode: 'E004', employeeName: 'Lerato Ndlovu' }),
      ],
      source: 'upload',
    });

    assert.equal(result.replaced, true);
    const summaries = await listReports(db);
    assert.equal(summaries.length, 1, 'no duplicate months');
    assert.equal(summaries[0].records, 3);
    assert.equal(summaries[0].id, result.id);

    // old rows are gone via cascade (2 -> 3 records, not 5)
    const [{ count }] = await db.query<{ count: string }>('select count(*)::text as count from employees');
    assert.equal(count, '3');
    const [{ count: attendanceCount }] = await db.query<{ count: string }>(
      'select count(*)::text as count from attendance',
    );
    assert.equal(attendanceCount, '9', 'attendance rows cascade with their report');
    reportId = result.id;
  });

  it('preserves explicit createdAt when importing history', async () => {
    const result = await saveReport(db, {
      fileName: 'July.xlsx',
      period: '2026-07',
      attendanceColumns: [],
      createdAt: '2026-08-02T09:30:00.000Z',
      records: [record()],
      source: 'migration',
    });
    const rows = await db.query<{ created_at: Date | string; source: string }>(
      'select created_at, source from reports where id = $1',
      [result.id],
    );
    assert.equal(new Date(rows[0].created_at).toISOString(), '2026-08-02T09:30:00.000Z');
    assert.equal(rows[0].source, 'migration');
  });

  it('builds the period trend series', async () => {
    const trends = await getTrends(db);
    assert.deepEqual(
      trends.map((t) => t.period),
      ['2026-07', '2026-08'],
    );
    assert.equal(trends[1].active, 3);
    assert.equal(trends[1].inactive, 0);
  });

  it('rejects an invalid period and an empty report', async () => {
    await assert.rejects(
      () => saveReport(db, { fileName: 'x.xlsx', period: 'August 2026', attendanceColumns: [], records: [record()] }),
      ValidationError,
    );
    await assert.rejects(
      () => saveReport(db, { fileName: 'x.xlsx', period: '2026-09', attendanceColumns: [], records: [] }),
      ValidationError,
    );
  });

  it('deletes a single report, then purges the rest', async () => {
    await deleteReport(db, reportId);
    assert.equal(await getReport(db, reportId), null);
    await assert.rejects(() => deleteReport(db, reportId), NotFoundError);

    const removed = await purgeReports(db);
    assert.equal(removed, 1);
    assert.equal((await listReports(db)).length, 0);
  });
});
