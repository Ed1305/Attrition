import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as XLSX from 'xlsx';
import { extractPeriodFromFilename, parseRegister, type SheetInput } from '../src/lib/parseRegister.ts';

/**
 * These tests run the real parser — the same function the upload button calls —
 * against workbooks produced by SheetJS, so both the sheet layout and the
 * SheetJS round-trip are covered.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const days = Array.from({ length: 31 }, (_, i) => (i < 6 ? 26 + i : i - 5));

function registerRows(sections: Array<{ heading: string; rows: unknown[][] }>): unknown[][] {
  return [
    ['INVNT CAPE TOWN - MONTHLY EMPLOYEE REGISTER - AUGUST 2026'],
    [],
    [
      'EMPLOYEE CODE', 'EMPLOYEE NAME', 'START DATE', 'TEAM', 'MANAGER', 'TERMINATION DATE',
      ...days.map((_, i) => WEEKDAYS[i % 7]),
    ],
    ['', '', '', '', '', '', ...days],
    [],
    ...sections.flatMap((section) => [['', section.heading], ...section.rows, []]),
  ];
}

function workbookToSheets(workbook: XLSX.WorkBook): SheetInput[] {
  return workbook.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' }) as unknown[][],
  }));
}

function buildWorkbook() {
  const invnt = registerRows([
    {
      heading: 'TEAM MOSES',
      rows: [
        ['IN-001', 'Anele Khumalo', '12/03/2025', 'Team Moses', 'Moses Mabaso', '', ...days.map(() => 1)],
        ['IN-002', 'Thandi Mokoena', '12/03/2025', 'Team Moses', 'Moses Mabaso', '', ...days.map((_, i) => (i === 3 ? 'A' : 1))],
      ],
    },
    {
      heading: 'TEAM PROSPER',
      rows: [['IN-010', 'Lerato Mbeki', '12/03/2025', 'Team Prosper', 'Prosper Nkosi', '', ...days.map(() => 0)]],
    },
    {
      heading: 'RESIGNED EMPLOYEES',
      rows: [['IN-040', 'Mpho Maseko', '12/03/2025', 'Team Moses', 'Moses Mabaso', '14/08/2026', ...days.map(() => '')]],
    },
    {
      heading: 'AWOL EMPLOYEES',
      rows: [['IN-050', 'Kagiso Sithole', '12/03/2025', 'Team Prosper', 'Prosper Nkosi', '28/08/2026', ...days.map(() => '')]],
    },
    {
      heading: 'DROPPED OUT TRAINING/INCUBATION',
      rows: [['IN-060', 'Naledi Faku', '03/06/2026', 'Invnt Incubation', 'Nombeko Faku', '20/08/2026', ...days.map(() => '')]],
    },
  ]);

  const alpha = registerRows([
    {
      heading: 'TEAM ISIPHO',
      rows: [['AL-010', 'Naledi Khumalo', '12/03/2025', 'Team Isipho', 'Isipho Ndlovu', '', ...days.map(() => 1)]],
    },
    {
      heading: 'TERMINATED',
      rows: [['AL-040', 'Palesa Mthembu', '03/06/2026', '', 'Ayabonga Mbeki', '05/08/2026', ...days.map(() => '')]],
    },
  ]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(invnt), 'INVNT CAPE TOWN');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(alpha), 'ALPHA');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['notes']]), 'NOTES');
  return workbook;
}

describe('period from file name', () => {
  const now = new Date('2026-10-15T00:00:00Z');

  it('reads full month names', () => {
    assert.equal(extractPeriodFromFilename('Attrition - August 2026.xlsx', now), '2026-08');
    assert.equal(extractPeriodFromFilename('Register March 2026.xlsx', now), '2026-03');
  });

  it('reads short month names without false positives', () => {
    assert.equal(extractPeriodFromFilename('reg-sep-2026.xlsx', now), '2026-09');
    assert.equal(extractPeriodFromFilename('INVNT MAR 2026.xlsx', now), '2026-03');
  });

  it('does not match a month inside another word', () => {
    // "may" inside "dismay" must not win; no year either
    assert.equal(extractPeriodFromFilename('dismay-report.xlsx', now), '2026-10');
  });

  it('falls back to the current month when nothing matches', () => {
    assert.equal(extractPeriodFromFilename('register.xlsx', now), '2026-10');
  });
});

describe('register parsing', () => {
  const sheets = workbookToSheets(buildWorkbook());
  const result = parseRegister(sheets, 'Attrition - August 2026.xlsx');

  it('reads both branches and ignores other sheets', () => {
    const branches = new Set(result.records.map((r) => r.branch));
    assert.deepEqual([...branches].sort(), ['ALPHA', 'INVNT CAPE TOWN']);
    assert.equal(result.records.length, 8);
    assert.equal(result.fileName, 'Attrition - August 2026.xlsx');
  });

  it('builds the 31-day attendance header', () => {
    assert.equal(result.attendanceColumns.length, 31);
    assert.equal(result.attendanceColumns[0], 'Mon(26)');
    assert.equal(result.attendanceColumns[30], 'Wed(25)');
  });

  it('keeps numeric, zero and code attendance values distinct', () => {
    const anele = result.records.find((r) => r.empCode === 'IN-001')!;
    const thandi = result.records.find((r) => r.empCode === 'IN-002')!;
    const lerato = result.records.find((r) => r.empCode === 'IN-010')!;

    assert.equal(anele.attendance['Mon(26)'], 1);
    assert.equal(lerato.attendance['Mon(26)'], 0);
    assert.equal(thandi.attendance[result.attendanceColumns[3]], 'A');
    assert.equal(Object.keys(anele.attendance).length, 31);
  });

  it('classifies active, resigned, awol, dropped out and terminated', () => {
    const byCode = new Map(result.records.map((r) => [r.empCode, r]));
    assert.equal(byCode.get('IN-001')!.category, 'ACTIVE');
    assert.equal(byCode.get('IN-040')!.category, 'RESIGNED');
    assert.equal(byCode.get('IN-050')!.category, 'AWOL');
    assert.equal(byCode.get('IN-060')!.category, 'DROPPED_OUT');
    assert.equal(byCode.get('AL-040')!.category, 'TERMINATED');
    assert.equal(byCode.get('IN-040')!.status, 'INACTIVE');
    assert.equal(byCode.get('IN-001')!.status, 'ACTIVE');
  });

  it('assigns every agent to a team (no UNASSIGNED rows)', () => {
    const unassigned = result.records.filter((r) => r.baseTeam === 'UNASSIGNED' || r.baseTeam === '');
    assert.deepEqual(unassigned.map((r) => r.empCode), []);
    assert.equal(result.records.find((r) => r.empCode === 'IN-040')!.baseTeam, 'TEAM MOSES');
    assert.equal(result.records.find((r) => r.empCode === 'IN-060')!.baseTeam, 'INVNT INCUBATION');
    assert.equal(result.records.find((r) => r.empCode === 'AL-040')!.baseTeam, 'TEAM AYABONGA');
    assert.deepEqual(result.warnings, []);
  });

  it('formats dates and termination dates', () => {
    assert.equal(result.records.find((r) => r.empCode === 'IN-001')!.startDate, '12/03/2025');
    assert.equal(result.records.find((r) => r.empCode === 'IN-001')!.endDate, 'Not Applicable');
    assert.equal(result.records.find((r) => r.empCode === 'IN-040')!.endDate, '14/08/2026');
  });

  it('warns when the attendance window is missing instead of failing silently', () => {
    const broken: SheetInput[] = [
      {
        name: 'INVNT CAPE TOWN',
        rows: [
          ['INVNT CAPE TOWN - REGISTER'],
          ['EMPLOYEE CODE', 'EMPLOYEE NAME', 'TEAM'],
          ['', 'TEAM MOSES'],
          ['IN-001', 'Anele Khumalo', 'Team Moses'],
        ],
      },
    ];
    const parsed = parseRegister(broken, 'x.xlsx');
    assert.equal(parsed.records.length, 1);
    assert.deepEqual(parsed.records[0].attendance, {});
    assert.ok(parsed.warnings.some((w) => /no attendance window/i.test(w)));
  });

  it('explains a workbook with the wrong sheet names', () => {
    assert.throws(
      () => parseRegister([{ name: 'Sheet1', rows: [['EMPLOYEE CODE']] }], 'x.xlsx'),
      /Could not find a sheet named/,
    );
  });

  it('explains a sheet with no employee rows', () => {
    assert.throws(
      () => parseRegister([{ name: 'ALPHA', rows: [['EMPLOYEE CODE', 'EMPLOYEE NAME']] }], 'x.xlsx'),
      /Could not find any employee rows/,
    );
  });
});
