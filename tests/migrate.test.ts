import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  describeConfigGap,
  MigrationRowError,
  normaliseRow,
  rowsFromExport,
  toParsedRow,
} from '../scripts/migrate-core.ts';

const legacyReport = {
  fileName: 'Attrition - August 2026.xlsx',
  attendanceColumns: ['Wed(26)', 'Thu(27)'],
  records: [
    {
      empCode: 'E001',
      employeeName: 'Thandi Mokoena',
      startDate: '12/03/2025',
      team: 'TEAM MOSES',
      baseTeam: 'TEAM MOSES',
      status: 'ACTIVE',
      category: 'ACTIVE',
      basedHeadcount: 'ACTIVE',
      endDate: 'Not Applicable',
      attendance: { 'Wed(26)': 1, 'Thu(27)': 'A' },
      branch: 'INVNT CAPE TOWN',
    },
  ],
};

describe('migration row parsing', () => {
  it('reads a PostgREST row with camelCase columns', () => {
    const raw = normaliseRow({ id: 7, fileName: 'a.xlsx', period: '2026-08', createdAt: '2026-09-01T10:00:00Z', data: legacyReport });
    assert.equal(raw.fileName, 'a.xlsx');
    assert.equal(raw.period, '2026-08');
    assert.equal(raw.createdAt, '2026-09-01T10:00:00Z');

    const parsed = toParsedRow(raw);
    assert.equal(parsed.period, '2026-08');
    assert.equal(parsed.records.length, 1);
    assert.deepEqual(parsed.attendanceColumns, ['Wed(26)', 'Thu(27)']);
    assert.equal(parsed.createdAt, '2026-09-01T10:00:00Z');
  });

  it('reads snake_case columns and a JSON-string data column', () => {
    const raw = normaliseRow({
      id: 'a',
      file_name: 'b.xlsx',
      period: '2026-07',
      created_at: '2026-08-01T00:00:00Z',
      data: JSON.stringify(legacyReport),
    });
    const parsed = toParsedRow(raw);
    assert.equal(parsed.fileName, 'b.xlsx');
    assert.equal(parsed.period, '2026-07');
    assert.equal(parsed.records.length, 1);
  });

  it('falls back to the createdAt month when period is absent', () => {
    const parsed = toParsedRow(normaliseRow({ data: legacyReport, created_at: '2026-03-15T12:00:00Z' }));
    assert.equal(parsed.period, '2026-03');
  });

  it('uses the fileName stored inside the payload when the column is missing', () => {
    const parsed = toParsedRow(normaliseRow({ period: '2026-08', data: legacyReport }));
    assert.equal(parsed.fileName, 'Attrition - August 2026.xlsx');
  });

  it('rejects an unusable period', () => {
    assert.throws(
      () => toParsedRow(normaliseRow({ period: 'August 2026', data: legacyReport })),
      (err: unknown) => err instanceof MigrationRowError && /unusable period/.test(err.message),
    );
  });

  it('rejects a row without records', () => {
    assert.throws(
      () => toParsedRow(normaliseRow({ period: '2026-08', data: { attendanceColumns: [] } })),
      (err: unknown) => err instanceof MigrationRowError && /no data\.records/.test(err.message),
    );
  });

  it('accepts the three export shapes', () => {
    assert.equal(rowsFromExport([{ period: '2026-08', data: legacyReport }]).length, 1);
    assert.equal(rowsFromExport({ reports: [{ period: '2026-08', data: legacyReport }] }).length, 1);
    assert.equal(rowsFromExport({ rows: [{ period: '2026-08', data: legacyReport }] }).length, 1);
    assert.throws(() => rowsFromExport({ nope: true }), MigrationRowError);
  });
});

describe('missing-credential guidance', () => {
  const base = 'SUPABASE_URL=https://abc.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=secret';

  it('points at the dashboard when nothing is configured', () => {
    const text = describeConfigGap([]).join('\n');
    assert.match(text, /No SUPABASE_\* variables found/);
    assert.match(text, /Project Settings -> API/);
    assert.match(text, /--file supabase-reports\.json/);
  });

  it('detects variables that are still commented out (the .env.example case)', () => {
    const text = describeConfigGap([{ path: '.env.local', text: `# ${base.replace('\n', '\n# ')}` }]).join('\n');
    assert.match(text, /commented out/);
  });

  it('detects empty values', () => {
    const text = describeConfigGap([{ path: '.env.local', text: 'SUPABASE_URL=\nSUPABASE_SERVICE_ROLE_KEY=' }]).join('\n');
    assert.match(text, /are empty in \.env\.local/);
  });
});
