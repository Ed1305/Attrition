# Attrition — monthly headcount & attrition reporting

Uploads a monthly staff register (`.xlsx`) for the **INVNT Cape Town** and **ALPHA** floors, computes the per-team headcount / attrition tables, stores every report in **Neon Postgres**, and exports a summary workbook.

- **Frontend:** React 19 + Vite 6 + Tailwind 4 (`src/`)
- **Backend:** Express 4 (`server/app.ts`) — also deployable as a Vercel function (`api/index.ts`)
- **Database:** Neon Postgres via `pg` (`server/db.ts`, `server/repo.ts`, `db/schema.sql`)

> Migrating from the old Supabase build? See **[MIGRATION.md](./MIGRATION.md)** — it walks through exporting the old reports and loading them into Neon.
> Code review of the pre-migration app: **[ANALYSIS.md](./ANALYSIS.md)**.

---

## 1. Quick start

```bash
npm install

cp .env.example .env.local
#   DATABASE_URL=postgresql://…-pooler…neon.tech/neondb?sslmode=require
#   ADMIN_PASSCODE=something-only-you-know

npm run db:setup     # creates tables, indexes and views (idempotent)
npm run dev          # http://localhost:3000
```

`npm run db:demo` (instead of `db:setup`) also loads three months of clearly-fake demo data from `db/demo-seed.json`, so you can click through the UI before connecting real data.

### Getting the Neon connection string

1. Create a project at [neon.tech](https://neon.tech) (any region near Cape Town — `eu-central-1` / `aws-eu-west-1` both work).
2. **Connect** → copy the **Pooled connection** string (host contains `-pooler`).
3. Put it in `.env.local` as `DATABASE_URL`. Keep `sslmode=require`.

The app uses a small pool (`PGPOOL_MAX`, default 3) per serverless instance, which is what the pooled endpoint is designed for.

---

## 2. Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Neon pooled connection string |
| `ADMIN_PASSCODE` | yes (for writes) | enables admin login; never sent to the browser |
| `ADMIN_SESSION_SECRET` | no | cookie signing secret (defaults to `ADMIN_PASSCODE`) |
| `PGPOOL_MAX` | no | max pool connections per instance (default `3`) |
| `PORT` | no | HTTP port (default `3000`) |

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are **only** read by the one-off `db:migrate` script — the running app no longer talks to Supabase.

---

## 3. Scripts

| Command | What it does |
|---|---|
| `npm run dev` | dev server with Vite middleware |
| `npm run build` | production client build into `dist/` |
| `npm start` | production server (serves `dist/` + API) |
| `npm test` | repository tests against a real Postgres engine (PGlite/WASM) |
| `npm run lint` | `tsc --noEmit` over `src`, `server`, `api`, `scripts`, `tests` |
| `npm run db:setup` | apply `db/schema.sql` |
| `npm run db:demo` | schema + three months of demo data |
| `npm run db:migrate` | import old Supabase reports (`--from-supabase`, `--from-postgres` or `--file`) |
| `npm run dev:db` | local Postgres (PGlite over the wire protocol) on `:55432` |
| `npm run sample:register` | writes a realistic sample register to `samples/register-august-2026.xlsx` |

Local development **without** a Neon account:

```bash
npm run dev:db                                     # terminal 1
# terminal 2:
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres
npm run db:demo && npm run dev
```

---

## 3a. Uploading a register

Sign in with the admin passcode, open **Upload**, and drop the monthly `.xlsx` in.

What the parser expects (both sheets are optional, but at least one must exist):

| Sheet name | Notes |
|---|---|
| `INVNT CAPE TOWN` | processed as branch *INVNT CAPE TOWN* |
| `ALPHA` | processed as branch *ALPHA* |

Within each sheet:

* a header row containing an employee-code column — `EMP CODE`, `EMPLOYEE CODE`,
  `EMP NO`, `EMPLOYEE NO`, `STAFF NO` (all accepted, and the two sheets may differ);
* a name column (`EMPLOYEE NAME`, `AGENT NAME`, `FULL NAME` or `NAME`), plus optional
  `START DATE`, `TEAM`, `MANAGER` and `TERMINATION DATE` columns;
* a **row directly under the header** holding day numbers `26, 27, … 31, 1, … 25`
  (that defines the attendance window — 31 columns);
* section headings such as `TEAM MOSES`, `TEAM PROSPER`, `INVNT INCUBATION`,
  `RESIGNED EMPLOYEES`, `AWOL EMPLOYEES`, `DROPPED OUT TRAINING/INCUBATION`,
  `TERMINATED`, on their own row with no employee code.

Attendance cells accept `1` / `P` for present, `0` for absent, and any other code
(`A`, `L`, `SICK`) is stored and shown as-is.

**The reporting period is read from the file name** (`… August 2026.xlsx` → `2026-08`).
If the name has no month it falls back to the current month, so check the **Period**
box next to the branch switcher before saving — it is editable until the report is saved.

Try the whole flow with a generated sample:

```bash
npm run sample:register          # writes samples/register-august-2026.xlsx
```

If something in the sheet does not look right, the app reports it instead of guessing
silently: missing attendance window, agents that could not be assigned to a team, a sheet
with no recognisable header, or no employee rows at all.

---

## 3b. Troubleshooting

**`'tsx' is not recognized as an internal or external command`** (Windows) or
`tsx: command not found` (macOS/Linux)

`node_modules` is missing or was left half-installed — usually because an older
version of this project depended on `better-sqlite3`, a native module that needs a
C++ toolchain, so `npm install` aborted before creating `node_modules/.bin`.
That dependency is gone now; a clean install fixes it:

```powershell
if (Test-Path node_modules) { Remove-Item -Recurse -Force node_modules }
npm ci
npm run db:setup
```

If `node_modules` is already gone, `Remove-Item` reports *"Cannot find path … because it
does not exist"* — that is harmless, just run `npm ci`. (The `Test-Path` guard above, or
cmd's `if exist node_modules rmdir /s /q node_modules`, avoids the noise.)

`npm run …` now runs a pre-flight check (`scripts/preflight.mjs`) that detects this and
prints the fix instead of the bare "not recognized" error.

**`DatabaseNotConfiguredError: DATABASE_URL is not set`**

`.env.local` is missing or has no `DATABASE_URL`. Copy `.env.example` and paste the
Neon **pooled** connection string (`…-pooler…neon.tech`).

**`password authentication failed` / `ENOTFOUND`**

Use the *pooled* host from Neon → Connect, and keep `?sslmode=require` on the URL.

**Saving/uploading does nothing (401)**

`ADMIN_PASSCODE` is not set on the server, or the session expired — click
**Admin Login** again.

**Port 3000 already in use**

`PORT=3001 npm run dev` (PowerShell: `$env:PORT=3001; npm run dev`).

---

## 4. Data model

```
reports (id uuid pk, file_name, period unique 'YYYY-MM', attendance_columns jsonb,
         record_count, source, warnings jsonb, created_at)
   └── employees (id, report_id fk cascade, ordinal, emp_code, employee_name, start_date,
                  team, base_team, status, category, based_headcount, end_date, branch)
          └── attendance (employee_id fk cascade, day_label, value)   -- one row per day cell
```

* **One row per month.** `period` is validated (`YYYY-MM`) and **unique** — saving the same month again replaces it inside a transaction, so duplicate months can no longer accumulate.
* **`ordinal`** preserves the source spreadsheet row order, so the data table renders exactly like the sheet.
* **Attendance values stay text** (`1`, `0`, `A`, `SICK`…). The API converts purely numeric values back to numbers, so the UI contract (`number | string`) is unchanged.
* **Views**: `report_overview` (counts per report) powers `GET /api/reports`; `period_trend` powers `GET /api/trends` and the dashboard trend strip.

---

## 5. API

| Method | Route | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/health` | – | DB connectivity + whether admin login is configured |
| `GET` | `/api/admin/session` | – | `{ authenticated, configured }` |
| `POST` | `/api/admin/login` | – | `{ passcode }` → HttpOnly signed cookie (8 h, rate-limited) |
| `POST` | `/api/admin/logout` | – | clears the cookie |
| `GET` | `/api/reports` | – | period summaries, newest period first |
| `GET` | `/api/trends` | – | per-period active/inactive series |
| `GET` | `/api/reports/:id` | – | full report (`data.records[]` + `attendanceColumns`) |
| `POST` | `/api/reports` | **admin** | `{ fileName, period, data, warnings? }`; replaces the same period |
| `DELETE` | `/api/reports/:id` | **admin** | |
| `DELETE` | `/api/reports-purge/all` | **admin** | deletes every report; returns `{ removed }` |

Errors are JSON everywhere (`/api/*` never falls through to the SPA), with `400` validation, `401` auth, `404` missing, `413` payload too large, `503` database not configured/reachable.

---

## 6. Deploying

**Vercel** — import the repo, then set `DATABASE_URL`, `ADMIN_PASSCODE` (and optionally `ADMIN_SESSION_SECRET`) in *Project → Settings → Environment Variables*. `vercel.json` routes `/api/*` to `api/index.ts` and everything else to the SPA.

Apply the schema once against Neon (`npm run db:setup` from your machine or CI) — the app does not run migrations on boot.

---

## 7. Known gaps

Tracked in [ANALYSIS.md](./ANALYSIS.md); the ones that still matter after the database migration:

* The report's "attrition rate" is still a *stock* ratio (inactive ÷ register) and its numerator/denominator are inconsistent, so it can exceed 100%. Fix is scoped in ANALYSIS.md §5/P0-3 but not implemented here.
* The Excel parser still infers teams/statuses with substring heuristics (now covered by tests, and it reports what it could not recognise) and derives the period from the filename.
* `xlsx@0.18.5` has two unpatched advisories (prototype pollution, ReDoS) — consider SheetJS ≥ 0.20.2 from `cdn.sheetjs.com`.
