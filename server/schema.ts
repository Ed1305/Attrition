/**
 * Attrition schema (Neon / Postgres).
 *
 * Kept as a TypeScript module (rather than a .sql file read at runtime) so the
 * DDL ships inside the serverless function bundle: the deployed API applies it
 * lazily on the first query, which means a brand new Neon database works
 * without anyone running `npm run db:setup` by hand.
 *
 * Every statement is idempotent, so applying it repeatedly is safe.
 */
export const SCHEMA_SQL = `-- ============================================================================
--  Attrition — Neon (Postgres) schema
--  Run with:  npm run db:setup
--  Idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- reports: one row per monthly register upload (one period per row).
-- ---------------------------------------------------------------------------
create table if not exists reports (
  id                 uuid primary key,
  file_name          text        not null,
  period             text        not null,
  attendance_columns jsonb       not null default '[]'::jsonb,
  record_count       integer     not null default 0,
  source             text        not null default 'upload',
  warnings           jsonb       not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  constraint reports_period_format check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint reports_period_unique unique (period)
);

-- ---------------------------------------------------------------------------
-- employees: the register itself, one row per agent per report.
--   ordinal preserves the row order of the source spreadsheet.
-- ---------------------------------------------------------------------------
create table if not exists employees (
  id             integer generated always as identity primary key,
  report_id      uuid    not null references reports (id) on delete cascade,
  ordinal        integer not null,
  emp_code       text    not null default '',
  employee_name  text    not null default '',
  start_date     text,
  team           text,
  base_team      text,
  status         text,
  category       text,
  based_headcount text,
  end_date       text,
  branch         text    not null default '',
  constraint employees_category_check check (
    category is null or category in ('ACTIVE', 'AWOL', 'RESIGNED', 'DROPPED_OUT', 'TERMINATED', 'OTHER')
  ),
  constraint employees_report_ordinal_unique unique (report_id, ordinal)
);

-- ---------------------------------------------------------------------------
-- attendance: daily attendance code per employee.
--   value is stored as text so non-numeric codes ('A', 'SICK', 'P') survive
--   a round-trip; the API re-hydrates purely numeric values back to numbers.
-- ---------------------------------------------------------------------------
create table if not exists attendance (
  employee_id integer not null references employees (id) on delete cascade,
  day_label   text    not null,
  value       text    not null,
  primary key (employee_id, day_label)
);

create index if not exists employees_report_idx  on employees (report_id);
create index if not exists employees_period_idx  on employees (report_id, branch, category);
create index if not exists reports_period_idx    on reports (period desc);
create index if not exists attendance_emp_idx    on attendance (employee_id);

-- ---------------------------------------------------------------------------
-- Convenience views (used by /api/reports and /api/trends).
-- ---------------------------------------------------------------------------
create or replace view report_overview as
select
  r.id,
  r.file_name,
  r.period,
  r.source,
  r.created_at,
  count(e.id)::int                                                   as records,
  count(e.id) filter (where e.category = 'ACTIVE')::int              as active,
  count(e.id) filter (where e.category = 'AWOL')::int                as awol,
  count(e.id) filter (where e.category = 'RESIGNED')::int            as resigned,
  count(e.id) filter (where e.category = 'DROPPED_OUT')::int         as dropped_out,
  count(e.id) filter (where e.category = 'TERMINATED')::int          as terminated,
  count(e.id) filter (where e.category is distinct from 'ACTIVE')::int as inactive
from reports r
left join employees e on e.report_id = r.id
group by r.id;

create or replace view period_trend as
select
  r.period,
  count(e.id)::int                                          as records,
  count(e.id) filter (where e.category = 'ACTIVE')::int     as active,
  count(e.id) filter (where e.category is distinct from 'ACTIVE')::int as inactive,
  max(r.created_at)                                         as last_saved
from reports r
left join employees e on e.report_id = r.id
group by r.period
order by r.period;
`;
