import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import * as XLSX from 'xlsx';
import type { Db } from '../server/db.ts';
import { getReport, getTrends, listReports, saveReport } from '../server/repo.ts';
import { extractPeriodFromFilename, parseRegister, type SheetInput } from '../src/lib/parseRegister.ts';

/**
 * The whole upload path, minus the file picker:
 *   .xlsx on disk → SheetJS read → parseRegister → saveReport → getReport
 * This is exactly what the browser does (App.tsx processExcel → lib/api → /api/reports).
 */

const workdir = join(tmpdir(), 'attrition-upload-flow');
const sampleFile = join(workdir, 'sample-register.xlsx');

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

before(async () => {
  // 1. Generate the sample workbook the same way a user would receive one.
  await rm(workdir, { recursive: true, force: true });
  await mkdir(workdir, { recursive: true });
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/make-sample-register.ts', sampleFile], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });

  // 2. Fresh Postgres with the production schema.
  pglite = new PGlite();
  await pglite.waitReady;
  await pglite.exec(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  db = pgliteDb(pglite);
});

after(async () => {
  await pglite.close();
  await rm(workdir, { recursive: true, force: true });
});

/** Mirrors App.tsx: read the workbook, flatten each sheet, hand it to the parser. */
async function readRegister(path: string) {
  const workbook = XLSX.read(await readFile(path));
  const sheets: SheetInput[] = workbook.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' }) as unknown[][],
  }));
  return parseRegister(sheets, path.split(/[\\/]/).pop()!);
}

describe('upload → save → reload', () => {
  it('parses the generated workbook', async () => {
    const result = await readRegister(sampleFile);

    assert.equal(result.records.length, 22);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.attendanceColumns.length, 31);

    const branches = result.records.reduce<Record<string, number>>((acc, r) => {
      acc[r.branch] = (acc[r.branch] ?? 0) + 1;
      return acc;
    }, {});
    assert.deepEqual(branches, { 'INVNT CAPE TOWN': 15, ALPHA: 7 });

    const categories = new Set(result.records.map((r) => r.category));
    for (const expected of ['ACTIVE', 'RESIGNED', 'AWOL', 'DROPPED_OUT', 'TERMINATED']) {
      assert.ok(categories.has(expected as never), `missing category ${expected}`);
    }
  });

  it('saves the parsed report and reloads it unchanged', async () => {
    const parsed = await readRegister(sampleFile);
    const period = extractPeriodFromFilename('Attrition - August 2026.xlsx');

    const saved = await saveReport(db, {
      fileName: 'sample-register.xlsx',
      period,
      records: parsed.records,
      attendanceColumns: parsed.attendanceColumns,
    });
    assert.equal(saved.replaced, false);

    const stored = await getReport(db, saved.id);
    assert.ok(stored);
    assert.equal(stored.period, '2026-08');
    assert.equal(stored.report.records.length, parsed.records.length);
    assert.deepEqual(stored.report.attendanceColumns, parsed.attendanceColumns);

    // Every record survives, field by field, including attendance codes.
    for (const [index, original] of parsed.records.entries()) {
      const reloaded = stored.report.records[index];
      assert.deepEqual(reloaded, original, `record ${index} (${original.empCode}) changed`);
    }
  });

  it('shows the report on the dashboard with correct counts', async () => {
    const summaries = await listReports(db);
    const august = summaries.find((s) => s.period === '2026-08');
    assert.ok(august);
    assert.equal(august.records, 22);
    assert.equal(august.active, 16);
    assert.equal(august.resigned, 3);
    assert.equal(august.awol, 1);
    assert.equal(august.droppedOut, 1);
    assert.equal(august.terminated, 1);
    assert.equal(august.inactive, 6);
    assert.equal(august.source, 'upload');

    const trend = (await getTrends(db)).find((t) => t.period === '2026-08');
    assert.equal(trend?.records, 22);
  });

  it('re-uploading the same month replaces it instead of duplicating', async () => {
    const parsed = await readRegister(sampleFile);
    const saved = await saveReport(db, {
      fileName: 'sample-register.xlsx',
      period: '2026-08',
      records: parsed.records.slice(0, 10),
      attendanceColumns: parsed.attendanceColumns,
    });
    assert.equal(saved.replaced, true);

    const summaries = await listReports(db);
    assert.equal(summaries.filter((s) => s.period === '2026-08').length, 1);
    assert.equal(summaries.find((s) => s.period === '2026-08')!.records, 10);
  });
});
