# Supabase → Neon migration

What changed, how the old data gets across, and how to verify it.

The old app stored one Supabase row per save:

```
reports(id, fileName, period, data jsonb, createdAt)      -- data = whole ProcessedReport
```

The new schema splits that blob into rows (`reports` → `employees` → `attendance`), so a
report can be queried per month, per branch and per team in SQL instead of in the browser.

The JSON payload the API returns is byte-for-byte the shape the UI already consumed
(`{ fileName, records[], attendanceColumns[] }`), so **no report is lost or reshaped on the
way back out** — `npm test` asserts the round-trip, including non-numeric attendance codes.

---

## 1. Create the Neon database

1. [neon.tech](https://neon.tech) → **New project**.
2. Copy the **pooled** connection string (`…-pooler…neon.tech`) — not the direct one.
3. Add it to `.env.local`:

```bash
DATABASE_URL=postgresql://user:pass@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
ADMIN_PASSCODE=choose-something-long
```

4. Create the schema:

```bash
npm run db:setup
# Applying db/schema.sql …
# Ready: attendance, employees, period_trend, report_overview, reports
```

`db/schema.sql` is idempotent (`create table if not exists`, `create or replace view`), so it
is safe to re-run.

---

## 2. Pull the existing rows out of Supabase

**Option A — straight from Supabase (recommended).**

Add the legacy credentials *temporarily* to `.env.local`:

```bash
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

Preview first, then write:

```bash
npm run db:migrate -- --from-supabase --dry-run
npm run db:migrate -- --from-supabase
```

Output:

```
Found 8 report(s) to migrate.
  ✓ 2026-01  187 records
  ✓ 2026-02  191 records
  …
Migrated 8/8 report(s).
```

The script pages through the REST API (200 rows/request), keeps each report's original
`createdAt`, and tags imported rows with `source = 'migration'`.

**Option B — from a JSON export.**

If you ever exported the table (`select * from reports` → *Download CSV/JSON* in the Supabase
table editor), feed the file directly:

```bash
npm run db:migrate -- --file supabase-reports.json
```

Accepted shapes: an array of rows, `{ reports: [...] }`, or `{ rows: [...] }`. Both `camelCase`
(`fileName`, `createdAt`) and `snake_case` (`file_name`, `created_at`) columns work, and `data`
may be either a JSON object or a JSON string.

**Then remove `SUPABASE_*` from `.env.local` / your host** — nothing in the running app reads
them any more.

---

## 3. What the importer refuses (on purpose)

A row is skipped — with a message, and a non-zero exit code — when it cannot be represented
faithfully:

| Situation | Message |
|---|---|
| `period` is not `YYYY-MM` (`"August 2026"`) | `row has an unusable period` |
| no `data.records` array | `row has no data.records array` |
| zero records | `Report contains no employee records.` |

Fix those rows in the export (or correct the period in Supabase and re-run) — a partial import
is reported explicitly rather than silently creating an empty month.

Re-running the import is safe: **the same period replaces itself** in one transaction, so you
can import repeatedly while you clean the source data.

---

## 4. Verify

```bash
# Row counts per period, straight from Postgres
psql "$DATABASE_URL" -c "select * from period_trend;"

# Spot-check one month against the old screen: names, categories, attendance codes
psql "$DATABASE_URL" -c "
  select e.emp_code, e.employee_name, e.category, e.base_team, count(a.*) as attendance_days
    from employees e left join attendance a on a.employee_id = e.id
   where e.report_id = (select id from reports where period = '2026-08')
   group by e.id order by e.ordinal limit 10;"
```

Or in the app: open **History** → each period shows `records / active / awol / resigned /
dropped out / terminated` counts computed by SQL, and the dashboard trend strip is drawn from
`period_trend`.

Sanity checklist:

- [ ] Number of reports in Neon = number of rows in Supabase (`select count(*) from reports`).
- [ ] `period_trend.records` matches the record count you used to see per month.
- [ ] A month with non-numeric attendance codes (`A`, `SICK`) still renders those codes in the
      data table (they are stored as text, not coerced to `0`).
- [ ] Saving an existing month from the UI replaces it (`replaced: true`) instead of adding a duplicate.

---

## 5. Keeping the old data around

Don't delete the Supabase project straight away. Keep it read-only for a month:

* the importer is repeatable, so a fixed row can always be re-imported;
* `MIGRATION.md` §3 lists exactly which rows need manual attention;
* take a JSON export (`db:migrate --file`) and archive it — it is portable and schema-free.

Once you are happy: remove the Supabase keys from every environment, then pause the project.

---

## 6. Behaviour changes that came with the move

| Before (Supabase) | After (Neon) |
|---|---|
| Admin flag in `localStorage`, passcode in the JS bundle | HttpOnly signed session cookie; passcode server-side only |
| Every write route unauthenticated | `401` unless the session cookie is valid |
| `data` JSONB blob, one row per save | normalised `employees` / `attendance` rows |
| Duplicate months possible | `unique (period)`, replaced transactionally |
| Numeric `id` (purge used `id != 0`) | `uuid` ids, validated |
| Realtime `postgres_changes` in the browser | server-side polling every 60 s while the tab is visible (no anon DB key in the browser at all) |
| `500 { error }` when unconfigured | `503` with the reason; `/api/health` reports DB + admin state |
| `/api/settings*` silently returned HTML | unknown `/api/*` routes return JSON `404` |
