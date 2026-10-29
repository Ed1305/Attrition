/**
 * Register parsing, extracted from App.tsx so the riskiest logic in the app can
 * be tested. Behaviour is intentionally identical to the in-component version
 * that preceded it — the differences are (a) it takes plain sheet rows instead
 * of a SheetJS workbook (keeps xlsx lazily loaded in the browser) and (b) it
 * reports `warnings` instead of failing silently.
 */
import type { EmployeeRecord } from '../types';

/** A worksheet already flattened to rows of cell values. */
export interface SheetInput {
  name: string;
  rows: unknown[][];
}

export interface ParseResult {
  fileName: string;
  records: EmployeeRecord[];
  attendanceColumns: string[];
  /** Human-readable notes about anything that looked off in the workbook. */
  warnings: string[];
}

const SHEETS = [
  { name: 'INVNT CAPE TOWN', branch: 'INVNT CAPE TOWN' },
  { name: 'ALPHA', branch: 'ALPHA' },
];

const ALPHA_BASE_TEAMS = [
  'TEAM AYABONGA',
  'TEAM ISIPHO',
  'TEAM KHAYALETHU',
  'TEAM THANDUXOLO',
  'ALPHA INCUBATION',
];

const INVNT_BASE_TEAMS = [
  'TEAM PROSPER',
  'TEAM SONWABILE',
  'TEAM MOSES',
  'INVNT INCUBATION',
  'NOMBEKO',
];

const ALPHA_TARGET_TEAMS = [
  ...ALPHA_BASE_TEAMS,
  'RESIGNED EMPLOYEES',
  'AWOL EMPLOYEES',
  'DROPPED OUT INCUBATION',
  'TERMINATED',
];

const INVNT_TARGET_TEAMS = [
  'TEAM PROSPER',
  'TEAM SONWABILE',
  'TEAM MOSES',
  'INVNT INCUBATION',
  'RESIGNED EMPLOYEES',
  'AWOLEMPLOYEES',
  'AWOL EMPLOYEES',
  'AWOL',
  'DROPPED OUT TRAINING/INCUBATION',
  'TERMINATED',
  'NOMBEKO',
];

const EXCLUDED_NAMES = [
  "FAILED PRACTICAL'S",
  'TEMPORARY LAID OFF',
  'MATERNITY LEAVE',
  'EMPLOYEE CODE',
  'EMPLOYEE NAME',
  'START DATE',
  'TERMINATION DATE',
];

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));

/** `Attrition - March 2026.xlsx` → `2026-03`. Falls back to the current month. */
export function extractPeriodFromFilename(filename: string, now = new Date()): string {
  const lower = filename.toLowerCase();
  let monthIndex = -1;

  // Word boundaries for both spellings, otherwise "dismay-report.xlsx" would be
  // filed as May and "marching.xlsx" as March.
  const words = lower.split(/[^a-z]+/).filter(Boolean);
  monthIndex = MONTHS.findIndex((month) => words.includes(month));
  if (monthIndex === -1) {
    monthIndex = SHORT_MONTHS.findIndex((month) => words.includes(month));
  }

  const yearMatch = filename.match(/\b(20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : String(now.getFullYear());

  if (monthIndex !== -1) {
    return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  }

  return `${year}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const text = (value: unknown) => String(value ?? '').trim();

/** Excel serial date → dd/mm/yyyy, anything else → its string form. */
function formatDate(value: unknown): string {
  if (typeof value === 'number') {
    return new Date(Math.round((value - 25569) * 86400 * 1000)).toLocaleDateString('en-GB');
  }
  return String(value);
}

const isBlankDate = (value: unknown) => {
  const raw = text(value).toUpperCase();
  return raw === '' || raw === 'N/A' || raw === 'NOT APPLICABLE';
};

const EMP_CODE_MATCHERS = [
  ['EMP CODE'],
  ['EMPLOYEE CODE'],
  ['EMP NO'],
  ['EMPLOYEE NO'],
  ['STAFF NO'],
  ['STAFF NUMBER'],
  ['EMP CODE', 'EMPLOYEE CODE', 'EMP NO', 'STAFF NO'],
];

/**
 * Finds a column by trying exact header names first, then "contains" variants.
 * Real registers use both "EMP CODE" and "EMPLOYEE CODE" (and the two sheets can
 * differ), which the previous `includes('EMP CODE')` check silently missed.
 */
function findColumn(row: unknown[], matchers: string[][]): number {
  const cells = row.map((cell) => text(cell).toUpperCase().replace(/\s+/g, ' '));
  for (const group of matchers) {
    for (const candidate of group) {
      const exact = cells.indexOf(candidate);
      if (exact !== -1) return exact;
    }
    for (const candidate of group) {
      const partial = cells.findIndex((cell) => cell !== '' && cell.includes(candidate));
      if (partial !== -1) return partial;
    }
  }
  return -1;
}

export function parseRegister(sheets: SheetInput[], fileName: string): ParseResult {
  const records: EmployeeRecord[] = [];
  const warnings: string[] = [];
  let attendanceColumns: string[] = [];

  const matchedSheets = sheets.filter((sheet) =>
    SHEETS.some((target) => sheet.name.trim().toUpperCase() === target.name.toUpperCase()),
  );

  if (matchedSheets.length === 0) {
    throw new Error(
      `Could not find a sheet named "INVNT CAPE TOWN" or "ALPHA". Sheets found: ${
        sheets.map((s) => `"${s.name}"`).join(', ') || 'none'
      }.`,
    );
  }

  for (const sheetInfo of SHEETS) {
    const sheet = sheets.find((s) => s.name.trim().toUpperCase() === sheetInfo.name.toUpperCase());
    if (!sheet) continue;

    const rows = sheet.rows;
    const isAlpha = sheetInfo.branch === 'ALPHA';

    // 1. Header row: the first row mentioning EMP CODE.
    const headerRowIdx = rows.findIndex(
      (row) => Array.isArray(row) && findColumn(row, EMP_CODE_MATCHERS) !== -1,
    );
    if (headerRowIdx === -1) {
      warnings.push(
        `Sheet "${sheetInfo.name}" has no employee-code header row (expected "EMP CODE" or "EMPLOYEE CODE") — skipped.`,
      );
      continue;
    }

    const headerRow = rows[headerRowIdx] ?? [];
    const subHeaderRow = rows[headerRowIdx + 1] ?? [];

    const empCodeIdx = findColumn(headerRow, [
      ['EMP CODE'],
      ['EMPLOYEE CODE'],
      ['EMP NO'],
      ['EMPLOYEE NO'],
      ['STAFF NO'],
      ['STAFF NUMBER'],
      ['EMP CODE', 'EMPLOYEE CODE', 'EMP NO', 'STAFF NO'],
    ]);
    const nameIdx = findColumn(headerRow, [
      ['EMPLOYEE NAME'],
      ['AGENT NAME'],
      ['FULL NAME'],
      ['NAME'],
    ]);
    const startIdx = findColumn(headerRow, [['START DATE'], ['DATE STARTED'], ['START']]);
    const teamColIdx = findColumn(headerRow, [
      ['TEAM'],
      ['TEAM NAME'],
      ['DEPARTMENT'],
      ['TEAM', 'TEAM NAME'],
    ]);
    const managerIdx = findColumn(headerRow, [['MANAGER'], ['TEAM LEADER'], ['SUPERVISOR'], ['MANAGER']]);
    const termIdx = headerRow.findIndex((h) => {
      const s = text(h).toUpperCase().replace(/[^A-Z]/g, '');
      return (
        s === 'TERMINATIONDATE' ||
        s.includes('TERMINATIONDATE') ||
        s.includes('TERMDATE') ||
        s.includes('TERMINATE') ||
        s.includes('TERMINATION')
      );
    });

    if (nameIdx === -1) {
      warnings.push(`Sheet "${sheetInfo.name}" has no "EMPLOYEE NAME" column — skipped.`);
      continue;
    }

    // 2. Attendance window: sub-headers starting at day 26 and ending at day 25.
    const startDayIdx = subHeaderRow.findIndex((h) => text(h) === '26');
    let endDayIdx = -1;
    if (startDayIdx !== -1) {
      for (let j = startDayIdx; j < subHeaderRow.length; j++) {
        if (text(subHeaderRow[j]) === '25') {
          endDayIdx = j;
          break;
        }
      }
    }

    const sheetAttendanceHeaders: string[] = [];
    if (startDayIdx !== -1 && endDayIdx !== -1) {
      for (let j = startDayIdx; j <= endDayIdx; j++) {
        sheetAttendanceHeaders.push(`${text(headerRow[j])}(${text(subHeaderRow[j])})`);
      }
    } else {
      warnings.push(
        `Sheet "${sheetInfo.name}" has no attendance window (day "26" … "25" under the header row) — ` +
          'agents were imported without attendance data.',
      );
    }

    if (attendanceColumns.length === 0) attendanceColumns = sheetAttendanceHeaders;

    // 3. Section headings, then rows.
    let currentTeam = '';
    let lastBaseTeam = '';
    const baseTeams = isAlpha ? ALPHA_BASE_TEAMS : INVNT_BASE_TEAMS;
    const targetTeams = isAlpha ? ALPHA_TARGET_TEAMS : INVNT_TARGET_TEAMS;

    const rememberBaseTeam = (team: string) => {
      const upper = team.toUpperCase();
      if (baseTeams.includes(upper)) {
        lastBaseTeam = upper === 'NOMBEKO' ? 'INVNT INCUBATION' : upper;
      }
    };

    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const empCode = text(row[empCodeIdx]);
      const empName = text(row[nameIdx]);
      const rowString = row.join(' ').toUpperCase();

      const foundTeam = targetTeams.find((team) => rowString.includes(team));
      if (foundTeam && (empCode === '' || empCode.toUpperCase() === 'EMPLOYEE CODE')) {
        currentTeam = foundTeam;
        rememberBaseTeam(foundTeam);
        continue;
      }

      const nameAsTeam = targetTeams.find((team) => empName.toUpperCase() === team);
      if (nameAsTeam && (empCode === '' || empCode.toUpperCase() === 'EMPLOYEE CODE')) {
        currentTeam = nameAsTeam;
        rememberBaseTeam(nameAsTeam);
        continue;
      }

      if (!currentTeam || empCode === '' || empName === '') continue;

      const upperEmpCode = empCode.toUpperCase();
      const upperEmpName = empName.toUpperCase();

      if (upperEmpCode === 'EMPLOYEE CODE' || upperEmpName === 'EMPLOYEE NAME') continue;
      if (EXCLUDED_NAMES.some((val) => upperEmpName.includes(val))) continue;
      if (targetTeams.some((team) => upperEmpName === team)) continue;

      const rawEndDate = termIdx !== -1 ? row[termIdx] : null;
      const hasTerminationDate = !isBlankDate(rawEndDate);

      const teamUpper = currentTeam.toUpperCase();
      const isInactive =
        teamUpper.includes('RESIGNED') ||
        teamUpper.includes('AWOL') ||
        teamUpper.includes('DROPPED') ||
        teamUpper.includes('TERMINATED') ||
        Boolean(hasTerminationDate);

      const status = isInactive ? 'INACTIVE' : 'ACTIVE';

      let category: EmployeeRecord['category'] = 'ACTIVE';
      if (teamUpper.includes('RESIGNED')) category = 'RESIGNED';
      else if (teamUpper.includes('AWOL')) category = 'AWOL';
      else if (teamUpper.includes('DROPPED')) category = 'DROPPED_OUT';
      else if (teamUpper.includes('TERMINATED')) category = 'TERMINATED';
      else if (hasTerminationDate) category = 'TERMINATED';

      let baseTeam = '';
      if (isAlpha) {
        if (rowString.includes('AYABONGA')) baseTeam = 'TEAM AYABONGA';
        else if (rowString.includes('ISIPHO')) baseTeam = 'TEAM ISIPHO';
        else if (rowString.includes('KHAYALETHU')) baseTeam = 'TEAM KHAYALETHU';
        else if (rowString.includes('THANDUXOLO')) baseTeam = 'TEAM THANDUXOLO';
        else if (rowString.includes('INCUBATION')) baseTeam = 'ALPHA INCUBATION';
      } else {
        if (rowString.includes('MOSES')) baseTeam = 'TEAM MOSES';
        else if (rowString.includes('PROSPER')) baseTeam = 'TEAM PROSPER';
        else if (rowString.includes('SONWABILE')) baseTeam = 'TEAM SONWABILE';
        else if (rowString.includes('INCUBATION') || rowString.includes('NOMBEKO')) baseTeam = 'INVNT INCUBATION';
      }

      if (!baseTeam && teamColIdx !== -1) {
        const teamFromCol = text(row[teamColIdx]).toUpperCase();
        if (teamFromCol) {
          if (isAlpha) {
            if (teamFromCol.includes('AYABONGA')) baseTeam = 'TEAM AYABONGA';
            else if (teamFromCol.includes('ISIPHO')) baseTeam = 'TEAM ISIPHO';
            else if (teamFromCol.includes('KHAYALETHU')) baseTeam = 'TEAM KHAYALETHU';
            else if (teamFromCol.includes('THANDUXOLO')) baseTeam = 'TEAM THANDUXOLO';
            else if (teamFromCol.includes('INCUBATION')) baseTeam = 'ALPHA INCUBATION';
          } else {
            if (teamFromCol.includes('NOMBEKO')) baseTeam = 'INVNT INCUBATION';
            else if (teamFromCol.includes('MOSES')) baseTeam = 'TEAM MOSES';
            else if (teamFromCol.includes('PROSPER')) baseTeam = 'TEAM PROSPER';
            else if (teamFromCol.includes('SONWABILE')) baseTeam = 'TEAM SONWABILE';
            else if (teamFromCol.includes('INCUBATION')) baseTeam = 'INVNT INCUBATION';
          }
        }
      }

      // ALPHA inactive rows sometimes only name the manager.
      if (isAlpha && isInactive && !baseTeam && managerIdx !== -1) {
        const managerName = text(row[managerIdx]).toUpperCase();
        if (managerName) {
          if (managerName.includes('AYABONGA')) baseTeam = 'TEAM AYABONGA';
          else if (managerName.includes('ISIPHO')) baseTeam = 'TEAM ISIPHO';
          else if (managerName.includes('KHAYALETHU')) baseTeam = 'TEAM KHAYALETHU';
          else if (managerName.includes('THANDUXOLO')) baseTeam = 'TEAM THANDUXOLO';
          else if (managerName.includes('INCUBATION')) baseTeam = 'ALPHA INCUBATION';
        }
      }

      if (!baseTeam) {
        if (category === 'ACTIVE') {
          baseTeam = currentTeam.toUpperCase();
          if (!isAlpha && baseTeam === 'NOMBEKO') baseTeam = 'INVNT INCUBATION';
        } else {
          baseTeam = lastBaseTeam || 'UNASSIGNED';
        }
      }

      // Normalise whatever we ended up with.
      if (isAlpha) {
        if (baseTeam.includes('AYABONGA')) baseTeam = 'TEAM AYABONGA';
        else if (baseTeam.includes('ISIPHO')) baseTeam = 'TEAM ISIPHO';
        else if (baseTeam.includes('KHAYALETHU')) baseTeam = 'TEAM KHAYALETHU';
        else if (baseTeam.includes('THANDUXOLO')) baseTeam = 'TEAM THANDUXOLO';
        else if (baseTeam.includes('INCUBATION')) baseTeam = 'ALPHA INCUBATION';
      } else {
        if (baseTeam.includes('MOSES')) baseTeam = 'TEAM MOSES';
        else if (baseTeam.includes('PROSPER')) baseTeam = 'TEAM PROSPER';
        else if (baseTeam.includes('SONWABILE')) baseTeam = 'TEAM SONWABILE';
        else if (baseTeam.includes('INCUBATION')) baseTeam = 'INVNT INCUBATION';
        else if (baseTeam.includes('NOMBEKO')) baseTeam = 'INVNT INCUBATION';
      }

      let displayTeam = currentTeam;
      if (category === 'RESIGNED') displayTeam = 'RESIGNED EMP.';
      else if (category === 'AWOL') displayTeam = 'AWOL EMP.';
      else if (category === 'DROPPED_OUT') displayTeam = 'DROPPED OUT';
      else if (category === 'TERMINATED') displayTeam = 'TERMINATED';

      const attendance: Record<string, number | string> = {};
      if (startDayIdx !== -1 && endDayIdx !== -1) {
        for (let j = startDayIdx; j <= endDayIdx; j++) {
          const header = sheetAttendanceHeaders[j - startDayIdx];
          const val = row[j];
          const present = val === 1 || text(val) === '1' || text(val).toUpperCase() === 'P';
          attendance[header] = present ? 1 : ((val || 0) as number | string);
        }
      }

      records.push({
        empCode,
        employeeName: empName,
        startDate: row[startIdx] ? formatDate(row[startIdx]) : 'N/A',
        team: displayTeam,
        baseTeam,
        status,
        category,
        basedHeadcount: status,
        endDate: isInactive ? (isBlankDate(rawEndDate) ? 'N/A' : formatDate(rawEndDate)) : 'Not Applicable',
        attendance,
        branch: sheetInfo.branch,
      });
    }
  }

  if (records.length === 0) {
    throw new Error(
      `Could not find any employee rows in "INVNT CAPE TOWN" or "ALPHA". ` +
        'Expected an "EMPLOYEE CODE" header row followed by sections such as "TEAM MOSES".',
    );
  }

  const unassigned = records.filter((r) => r.baseTeam === 'UNASSIGNED').length;
  if (unassigned > 0) {
    warnings.push(
      `${unassigned} agent(s) could not be assigned to a team (shown as UNASSIGNED) — check the team headings in the sheet.`,
    );
  }

  const missingAttendance = records.filter((r) => Object.keys(r.attendance).length === 0).length;
  if (missingAttendance === records.length && records.length > 0) {
    warnings.push('No attendance values were found for any agent.');
  }

  return { fileName, records, attendanceColumns, warnings };
}
