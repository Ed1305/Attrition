/**
 * Generates a realistic register workbook for testing the upload flow.
 *
 *   npm run sample:register            # writes sample-register.xlsx
 *
 * The layout mirrors the real thing: a title row, an EMPLOYEE CODE header row,
 * a day-number sub-header row (26 … 25), section headings for each team, and
 * the inactive sections (RESIGNED / AWOL / DROPPED OUT / TERMINATED).
 */
import * as XLSX from 'xlsx';

const outFile = process.argv[2] ?? 'sample-register.xlsx';

const WEEKDDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// 26, 27, 28, 29, 30, 31, 1 … 25 — the real register's 26th-to-25th window.
const days = Array.from({ length: 31 }, (_, i) => (i < 6 ? 26 + i : i - 5));
const weekdayRow = days.map((_, i) => WEEKDDAYS[(i + 1) % 7]);

type Person = { code: string; name: string; start: string; team: string; manager: string; end: string };

function person(code: string, name: string, team: string, manager: string, start = '12/03/2025', end = ''): Person {
  return { code, name, start, team, manager, end };
}

function attendanceFor(seed: number, active: boolean) {
  if (!active) return days.map(() => '');
  return days.map((_, i) => {
    const n = (seed + i * 7) % 12;
    if (n === 0) return 'A'; // absent
    if (n === 1) return 'SICK';
    if (n === 2) return 'L'; // leave
    return 1;
  });
}

const invntSections: Array<{ heading: string; people: Person[]; active: boolean }> = [
  {
    heading: 'TEAM MOSES',
    active: true,
    people: [
      person('IN-001', 'Anele Khumalo', 'Team Moses', 'Moses Mabaso'),
      person('IN-002', 'Thandi Mokoena', 'Team Moses', 'Moses Mabaso'),
      person('IN-003', 'Sipho Dlamini', 'Team Moses', 'Moses Mabaso'),
      person('IN-004', 'Nomsa Ndlovu', 'Team Moses', 'Moses Mabaso'),
    ],
  },
  {
    heading: 'TEAM PROSPER',
    active: true,
    people: [
      person('IN-010', 'Lerato Mbeki', 'Team Prosper', 'Prosper Nkosi'),
      person('IN-011', 'Bongani Jacobs', 'Team Prosper', 'Prosper Nkosi'),
      person('IN-012', 'Zanele Petersen', 'Team Prosper', 'Prosper Nkosi'),
    ],
  },
  {
    heading: 'TEAM SONWABILE',
    active: true,
    people: [
      person('IN-020', 'Lwazi Mthembu', 'Team Sonwabile', 'Sonwabile Sithole'),
      person('IN-021', 'Palesa Mahlangu', 'Team Sonwabile', 'Sonwabile Sithole'),
    ],
  },
  {
    heading: 'INVNT INCUBATION',
    active: true,
    people: [
      person('IN-030', 'Lutho Mgcina', 'Invnt Incubation', 'Nombeko Faku', '03/06/2026'),
      person('IN-031', 'Zinhle Ntuli', 'Invnt Incubation', 'Nombeko Faku', '03/06/2026'),
    ],
  },
  {
    heading: 'RESIGNED EMPLOYEES',
    active: false,
    people: [
      person('IN-040', 'Mpho Maseko', 'Team Moses', 'Moses Mabaso', '12/03/2025', '14/08/2026'),
      person('IN-041', 'Andile Botha', 'Team Prosper', 'Prosper Nkosi', '12/03/2025', '02/08/2026'),
    ],
  },
  {
    heading: 'AWOL EMPLOYEES',
    active: false,
    people: [person('IN-050', 'Kagiso Sithole', 'Team Moses', 'Moses Mabaso', '12/03/2025', '28/08/2026')],
  },
  {
    heading: 'DROPPED OUT TRAINING/INCUBATION',
    active: false,
    people: [person('IN-060', 'Naledi Faku', 'Invnt Incubation', 'Nombeko Faku', '03/06/2026', '20/08/2026')],
  },
];

const alphaSections: Array<{ heading: string; people: Person[]; active: boolean }> = [
  {
    heading: 'TEAM AYABONGA',
    active: true,
    people: [
      person('AL-001', 'Sibusiso Dlamini', 'Team Ayabonga', 'Ayabonga Mbeki'),
      person('AL-002', 'Tebogo Nkosi', 'Team Ayabonga', 'Ayabonga Mbeki'),
    ],
  },
  {
    heading: 'TEAM ISIPHO',
    active: true,
    people: [
      person('AL-010', 'Naledi Khumalo', 'Team Isipho', 'Isipho Ndlovu'),
      person('AL-011', 'Lwazi Botha', 'Team Isipho', 'Isipho Ndlovu'),
    ],
  },
  {
    heading: 'ALPHA INCUBATION',
    active: true,
    people: [person('AL-020', 'Zanele Mgcina', 'Alpha Incubation', 'Ayabonga Mbeki', '03/06/2026')],
  },
  {
    heading: 'RESIGNED EMPLOYEES',
    active: false,
    people: [person('AL-030', 'Andile Ntuli', '', 'Isipho Ndlovu', '03/06/2026', '11/08/2026')],
  },
  {
    heading: 'TERMINATED',
    active: false,
    people: [person('AL-040', 'Palesa Mthembu', '', 'Ayabonga Mbeki', '03/06/2026', '05/08/2026')],
  },
];

function buildSheet(branch: string, period: string, sections: typeof invntSections): unknown[][] {
  const rows: unknown[][] = [];
  rows.push([`${branch} - MONTHLY EMPLOYEE REGISTER - ${period}`]);
  rows.push([]);
  rows.push([
    'EMPLOYEE CODE', 'EMPLOYEE NAME', 'START DATE', 'TEAM', 'MANAGER', 'TERMINATION DATE',
    ...weekdayRow,
  ]);
  rows.push(['', '', '', '', '', '', ...days]);
  rows.push([]);

  let seed = branch === 'ALPHA' ? 3 : 0;
  for (const section of sections) {
    // Section heading sits in the name column, with no employee code.
    rows.push(['', section.heading]);
    for (const p of section.people) {
      rows.push([
        p.code, p.name, p.start, p.team, p.manager, p.end || '',
        ...attendanceFor(seed++, section.active),
      ]);
    }
    rows.push([]);
  }
  return rows;
}

const workbook = XLSX.utils.book_new();
for (const [branch, sections] of [
  ['INVNT CAPE TOWN', invntSections],
  ['ALPHA', alphaSections],
] as const) {
  const sheet = XLSX.utils.aoa_to_sheet(buildSheet(branch, 'AUGUST 2026', sections as typeof invntSections));
  sheet['!cols'] = [{ wch: 14 }, { wch: 24 }, { wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(workbook, sheet, branch);
}
// An extra sheet that must be ignored.
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['notes'], ['ignore me']]), 'NOTES');

XLSX.writeFile(workbook, outFile);
const total = [...invntSections, ...alphaSections].reduce((sum, s) => sum + s.people.length, 0);
console.log(`Wrote ${outFile} (${total} employees across INVNT CAPE TOWN + ALPHA)`);
