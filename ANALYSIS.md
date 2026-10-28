# Attrition — Technical & Product Analysis

**Repository:** `Ed1305/Attrition` · **Commit analysed:** `bbae3a3` (only commit in history)
**Analysed:** 28 October 2026 · **Reviewer:** Arena.ai agent
**Scope:** full source tree (`server.ts`, `api/index.ts`, `src/*`, config, dependencies) plus a clean install, type-check, production build, security audit and runtime smoke test.

---

## 1. Executive summary

**What this is.** A single-page operations tool ("Alpha Konnect — Attrition") for an outsourced contact-centre floor in Cape Town. An admin uploads a monthly Excel register (`INVNT CAPE TOWN` and/or `ALPHA` sheets); the browser parses it with SheetJS, infers each agent's team and employment status from section headings, computes a per-team headcount/attrition table, and lets the admin save the parsed snapshot to Supabase, browse history, and export a summary workbook.

**Is it good?** As a *prototype* it is unusually complete and the UI is genuinely well-crafted: clean editorial layout, branch switching, data-integrity warnings, realtime refresh, role-gated upload, documented flows. As a *production system handling employee PII and numbers people will make staffing decisions on*, it has three problems that matter more than everything else:

| # | Problem | Impact |
|---|---------|--------|
| 1 | **"Admin" is fake.** The passcode `ak_2026!` is hard-coded in the client and the flag lives in `localStorage`; **every write/delete API is unauthenticated**, including a public "purge everything" endpoint. | Anyone with the URL can read, overwrite or wipe all reports. Authorisation is cosmetic. |
| 2 | **The attrition formula is wrong by construction.** Numerator counts `TERMINATED` + `DROPPED_OUT`; denominator excludes them — so the rate can exceed 100% and termination-only teams silently report 0%. The in-app documentation states a different formula than the code implements. | The headline KPI the app exists to produce is unreliable. |
| 3 | **The pipeline is a fragile heuristic with no tests.** Team/status inference uses `rowString.includes('MOSES')`-style substring matching over the whole row, and the reporting "period" is guessed from the filename with a silent fallback to today's month. | A renamed team, a manager named Moses, or a stray date string silently produces a wrong report that still looks authoritative. |

Secondary but real: `npm install` **fails** on a clean clone in a restricted network (an unused native dependency), 18 dependency vulnerabilities (2 critical, 11 high), a 1.01 MB single-chunk bundle with 42% of it being an Excel library loaded for everyone, dead UI for a feature that was removed, and ~4 copies of the same duplicated formula block that have already drifted apart.

**Overall grade:** good prototype / demo, **not yet trustworthy as a source of truth**. Roughly 2–3 focused days of work (auth + formula + dependency cleanup) would move it from "demo" to "usable internal tool"; 2–3 weeks to "production".

---

## 2. Scorecard

| Dimension | Rating | One-line justification |
|---|---|---|
| Product concept & UX craft | 🟢 Good | Clear task flow, strong visual design, useful empty/error states |
| Correctness of business logic | 🔴 Poor | Broken rate formula, inconsistent totals, snapshot ≠ period attrition |
| Data pipeline robustness | 🔴 Poor | Substring heuristics, positional parsing, no validation, no tests |
| Security & privacy | 🔴 Critical | Client-side auth, unauthenticated destructive API, unpatched parser handling untrusted files |
| Data model & scalability | 🟡 Fair | JSONB blob per month works for 2 branches, blocks analytics |
| Build & dependency hygiene | 🟡 Fair | Install breaks; 3 unused deps; 18 CVEs; stale README |
| Maintainability | 🟡 Fair | 1,946-line `App.tsx`, formulas duplicated 4×, dead code, no CI/tests |
| Accessibility | 🟠 Weak | 8–10 px tables, colour-only status, icon-only buttons, `alert()` |
| Ops & observability | 🔴 Poor | No logs, monitoring, rate limits, migrations, or backups in repo |

Legend: 🟢 good · 🟡 needs work · 🟠 weak · 🔴 unacceptable for production.

---

## 3. Architecture

```
┌──────────────────────────── browser (React 19 + Vite 6 + Tailwind v4) ────────────────────────────┐
│  src/App.tsx  (1,946 lines — the entire application)                                              │
│    ├─ DashboardView ── SummaryReport (tables) / DataTable (raw grid + attendance)                 │
│    ├─ Upload (admin only) ── processExcel(): XLSX.read() → heuristics → EmployeeRecord[]           │
│    ├─ History ── fetch /api/reports, load/delete/purge                                            │
│    ├─ Documentation / Support  (static copy — one promise is no longer true)                      │
│    └─ SettingsView (dead code — never rendered, endpoints do not exist)                           │
│  src/supabase.ts ── anon client, realtime channel `postgres_changes` on `reports`                  │
└──────────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                               │ fetch('/api/...')   (same origin)
┌──────────────────────────────────────────────▼───────────────────────────────────────────────────┐
│  server.ts (Express 4) — dev: Vite middleware · prod: static dist/                                │
│    GET  /api/health                        → { supabaseConfigured }                               │
│    GET  /api/reports                       → id, fileName, period, createdAt                      │
│    GET  /api/reports/:id                   → full JSONB blob (parsed if string)                   │
│    POST /api/reports                       → insert { fileName, period, data }   ⚠ no auth        │
│    DELETE /api/reports/:id                 → delete by id                        ⚠ no auth        │
│    DELETE /api/reports-purge/all           → delete where id != 0                ⚠ no auth        │
│  api/index.ts — Vercel adapter: createServer() per invocation                                     │
└──────────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                               │ service_role key (bypasses RLS)
                                     ┌─────────▼──────────┐
                                     │  Supabase Postgres │  table `reports`
                                     └────────────────────┘  (id, fileName, period, data jsonb, createdAt)
```

**Stack:** React 19, TypeScript 5.8, Vite 6, Tailwind 4, `motion`, `lucide-react`, SheetJS 0.18.5, Express 4, `@supabase/supabase-js`, deployed to Vercel (single rewrite to `api/index.ts` + SPA fallback).

**Strengths worth keeping:** typed domain model (`EmployeeRecord`/`ProcessedReport`), a health endpoint that reports real configuration state, an explicit `UNASSIGNED` bucket surfaced as a UI warning, per-branch segmentation, and an export path that mirrors the on-screen report.

---

## 4. The data pipeline: how a spreadsheet becomes a report

`processExcel()` (`src/App.tsx:324-602`) runs entirely in the browser and makes seven positional/structural assumptions:

1. **Sheet names.** Only `INVNT CAPE TOWN` and `ALPHA` are processed (`:336-340`), matched case-insensitively after `trim()`. Any other sheet — a new branch, a corrected copy, `INVNT CAPE TOWN (2)` — is silently ignored (`if (!actualSheetName) continue`).
2. **Header row.** First row where any cell *contains* `EMP CODE` (`:352-359`).
3. **Attendance window.** Sub-header must contain an exact `'26'`, then a later exact `'25'` (`:378-387`). No `25` → **no attendance at all**, but the record is still imported with an empty attendance object and no warning.
4. **Column detection.** `includes('START DATE')`, `includes('EMPLOYEE NAME')`, `includes('MANAGER')`, and a `TERMINATIONDATE|TERMDATE|TERMINATE…` normaliser (`:362-376`). `TEAM` uses `s === 'TEAM' || … || s.includes('TEAM')` — the `includes` fallback can bind to `TEAM LEADER`, `TEAM MANAGER`, etc.
5. **Section detection.** `currentTeam` is set when a row *anywhere* in the sheet matches one of ~9 hard-coded heading strings (`:410-421`) — including near-duplicates `AWOL EMPLOYEES`, `AWOLEMPLOYEES`, `AWOL`, and `DROPPED OUT TRAINING/INCUBATION`.
6. **Row classification.** A row is a record if it has both an emp code and a name; status is derived from the current section and from *any* non-empty termination date (`:456-476`).
7. **Team attribution.** Priority: substring search of the entire joined row text (`rowString.includes('MOSES')` → Team Moses, `:486-520`) → the `TEAM` column → the `MANAGER` column (ALPHA inactive only) → inherit `lastBaseTeam` → `'UNASSIGNED'`.

**Why this is risky:** every step is a *guess* that fails silently. Nothing validates that required columns were found (`empCodeIdx === -1` would make `row[-1]` undefined and quietly produce empty codes), nothing records which guesses were used, and there is no "this file looks different from last month" check. The `UNASSIGNED` warning is the only self-diagnostic in the whole pipeline — a good instinct applied to one of six failure modes.

---

## 5. Correctness of the reported numbers (most important section)

### C-1 · Attrition rate can exceed 100%, and can hide 100% 🔴

The denominator is defined as `ACTIVE + AWOL + RESIGNED`; the numerator is `category !== 'ACTIVE'` — i.e. it *also* counts `TERMINATED` and `DROPPED_OUT`.

```ts
// src/App.tsx:1428-1440 (identical code at :663-683 export, :1496-1508 section 3)
const teamTotal     = filteredRecords.filter(… && ['ACTIVE','AWOL','RESIGNED'].includes(r.category)).length;
const teamAttrition = filteredRecords.filter(… && r.category !== 'ACTIVE').length;      // includes TERMINATED, DROPPED_OUT
const rate = teamTotal > 0 ? (teamAttrition / teamTotal) * 100 : 0;
```

Worked examples (same branch, same team):

| Active | AWOL | Resigned | Terminated | Dropped out | Denominator | Numerator | Displayed |
|---|---|---|---|---|---|---|---|
| 18 | 0 | 0 | 2 | 0 | 18 | 2 | **11%** |
| 1 | 0 | 0 | 5 | 0 | 1 | 5 | **500%** |
| 0 | 0 | 0 | 7 | 0 | 0 | 7 | **0%** (a fully terminated team looks perfect) |
| 10 | 0 | 1 | 3 | 1 | 11 | 5 | **45%** |

The third row is the dangerous one: a team that has been entirely terminated reports *0% attrition* and is painted green by the `rate > 10 ? red : green` rule (`:1432`). This is not an edge case — it is exactly what happens when a cohort/incubation team winds down, which is the event the business most needs to see.

### C-2 · The table's own subtotal doesn't add up 🟠

Section 1 lists five category rows, then a "Team Total From Register" row that is **not their sum** — it omits `DROPPED_OUT` and `TERMINATED` (`:1376-1379`). A reader who adds the column gets a different number from the row directly beneath it, with no footnote explaining why. In the export the same omission applies to `TOTAL HEADCOUNT` (`:663-666`), so the downloaded workbook under-reports the register.

### C-3 · The metric isn't attrition, it's a cumulative inactivity ratio 🟠

Attrition is a **flow over a period** (leavers ÷ average headcount, or leavers ÷ opening headcount). What the app computes is a **stock ratio** on a single snapshot: "of everyone in this month's register, what share is not active". Consequences:

- A leaver from 14 months ago still in the register counts in this month's rate. Rates ratchet upward and never recover.
- Comparing two months tells you nothing about *this* month's losses — yet the History screen invites exactly that comparison.
- The `>10%` colour threshold (`:1432`, `:1441`) has no time basis. In BPO floors, 10% *monthly* attrition is roughly industry-normal (~30–40% annualised); 10% *cumulative* is excellent. The traffic-light is therefore arbitrary and will paint almost everything green forever (or red forever as the register accumulates), depending on register hygiene.
- The in-app documentation says *"Calculated as (Inactive / Total Register) × 100"* (`:1633`) while the code computes `non-active / (active + AWOL + resigned)`. **The docs and the implementation disagree** — evidence that the definition was never pinned down.

### C-4 · Any termination date means "terminated today" 🟠

```ts
// src/App.tsx:456
const hasTerminationDate = rawEndDate && … !== 'N/A' && … !== 'NOT APPLICABLE';
```
No comparison with the reporting period. An agent on a fixed-term contract ending in four months is categorised `TERMINATED` and counted as attrition *now*; a date typed as `2026/13/45` is accepted as valid; tomorrow's date and last year's date are treated identically. Terminations should be filtered by the reporting window (`startOfPeriod ≤ endDate ≤ endOfPeriod`).

### C-5 · The formula exists in four places and has already drifted 🟠

The same block is copy-pasted at `:663-683` (Excel export), `:1355-1450` (Section 1 & 2), and `:1470-1515` (Section 3). They are not equivalent:

| | Includes `DROPPED_OUT`/`TERMINATED` in total? | Grand total scope |
|---|---|---|
| Excel export (`:663`) | ❌ | all teams |
| UI Section 2 "Including Incubation" | ❌ denominator, ✅ numerator | all teams |
| UI Section 3 "Excluding Incubation" | ❌ denominator, ✅ numerator | non-incubation only |

So the workbook the client emails out **is not the same report** as the one on screen. Any future change must be made in four places; three have already diverged.

### C-6 · Team assignment is order-dependent and can be hijacked by a name 🟠

`baseTeam` resolution searches `row.join(' ').toUpperCase()` for `'MOSES'`, `'PROSPER'`, `'SONWABILE'`, `'AYABONGA'`, `'ISIPHO'`, … (`:486-520`). An employee *named* Prosper, or a manager note in any cell, reassigns that row. For inactive rows that fail every test, the code falls back to `lastBaseTeam` — the last heading seen in the sheet — so **inserting a blank row or re-sorting the sheet changes historical team attribution**. There is no stable join key (no team id) and no audit trail.

### C-7 · Period, duplicates and "Latest" 🟡

- `extractPeriodFromFilename()` (`:285-318`) looks for a month name and a `20xx` year; otherwise it silently uses **today's month**. Uploading `Attrition - March submission.xlsx` in October files it under October. The user is never asked to confirm the period, and the period is a free-form string in the API (`POST /api/reports`).
- Nothing prevents two reports for the same `(branch, period)`: the history list can hold `2026-09` three times, and the Dashboard's "Latest" badge keys off `history[0].period === selectedPeriod` (`:1139`) — sorted by `createdAt`, not by period.
- Attendance totals use `Number(r.attendance[col]) || 0` (`:1584`): any non-numeric code (`A`, `L`, `SICK`) silently becomes 0 in the footer while still rendering in the grid, so "Total Attendance" under-counts codes and cannot be reconciled with the source sheet.
- `basedHeadcount` is a duplicate of `status` (`:574`) — a vestigial field that suggests an abandoned headcount model.

---

## 6. Security & privacy

### S-1 · Authentication is client-side theatre 🔴 (Critical)

```ts
if (passcode === 'ak_2026!') { setIsAdmin(true); localStorage.setItem('isAdmin','true'); }   // App.tsx:153-158
```
- The secret ships **in the public JS bundle** — verified: `grep "ak_2026!" dist/assets/*.js` matches after a production build.
- `isAdmin` is a `localStorage` boolean; `localStorage.setItem('isAdmin','true')` in DevTools grants admin, and the Upload tab + Save button are the only things gated.
- Consequences beyond UI: the "role" is the *entire* authorisation model. There are no server-side checks anywhere (§S-2), so the gate protects nothing.

### S-2 · Every mutating endpoint is unauthenticated 🔴 (Critical)

`server.ts:31-113` exposes `POST /api/reports`, `DELETE /api/reports/:id` and `DELETE /api/reports-purge/all` with no token, session, IP allow-list or CSRF protection. Because the server holds the **service_role** key, Supabase RLS offers no protection — the API is a confused deputy with root database access.

Verified against a local instance:
```
$ curl -X DELETE localhost:4173/api/reports-purge/all
500 {"error":"Failed to purge reports"}     # 500 only because Supabase is unconfigured
```
With credentials present, that request deletes the entire reporting history for anyone who can reach the URL — reachable from a bookmark, a bot, or a `<form>` on any website (no CSRF token, and `DELETE` via `fetch` from a same-site XSS is trivial). Minimum fix: server-side session auth on all `/api/*` writes + move deletion behind `POST` with CSRF protection, or require a signed admin token; never ship the passcode to the client.

### S-3 · Employee PII, and an anon key in the browser 🟠 (High — needs verification)

`data` is a JSONB blob of names, employee codes, start/termination dates and day-by-day attendance per agent. Two access paths exist:

1. **Server** via service_role (bypasses RLS) — as above.
2. **Browser** via `VITE_SUPABASE_ANON_KEY` and a realtime channel on `public.reports` (`App.tsx:102-117`).

If RLS is not enabled on `reports`, or if the table is in the `supabase_realtime` publication without a policy, then the anon key embedded in the bundle is sufficient to `select *` the entire workforce dataset — and the realtime channel will push changes to any browser that subscribes. The repository contains **no migrations or policy files**, so this cannot be audited from source; it must be checked in the Supabase dashboard. Recommendation: enable RLS, keep `reports` out of the anon-readable path entirely, and let realtime deliver only a "something changed" ping through an authenticated endpoint instead of row payloads.

### S-4 · Untrusted file parsing with an unpatched library 🟠 (High)

`npm audit` reports for `xlsx@0.18.5`: **Prototype Pollution (GHSA-4r6h-8v6p-xvw6)** and **ReDoS (GHSA-5pgg-2g8v-p4x9)** — *"No fix available"* on npm (SheetJS ships fixes only from their own CDN, ≥0.20.2). The app parses arbitrary uploaded workbooks, so a malicious `.xlsx` can pollute `Object.prototype` inside the admin's session (where the admin flag lives) or hang the tab. Mitigations: upgrade to SheetJS ≥0.20.2 from `cdn.sheetjs.com`, or parse server-side in an isolated worker with a timeout and file-size cap.

### S-5 · Availability & abuse surface 🟡

- `express.json({ limit: '50mb' })` (`server.ts:20`) — each request can allocate up to 50 MB of heap; a handful of concurrent posts will OOM a small Vercel function. The app's real payloads are far smaller.
- No rate limiting, no request validation (`fileName`, `period` and `data` are inserted as-is; `data` is never schema-checked), no maximum report count.
- No security headers (CSP, HSTS, X-Frame-Options), no CORS policy, no body-size cap per field.
- `.env.example` still documents `SMTP_*` secrets that nothing reads (Nodemailer was removed in the only commit).

### S-6 · Stale promises and hard-coded contacts 🟡

The Support screen advertises *"The system automatically checks for missing monthly reports every 12 hours… an email reminder is sent to EdenKabamba10@gmail.com"* (`:1697`) and the code documents `SMTP_HOST/SMTP_USER/SMTP_PASS` configuration. **No such code exists** — Nodemailer was removed in `bbae3a3`, and `/api/settings*` endpoints are absent (requests fall through to the SPA and return HTML with status 200, so the dead Settings form reports `Unexpected token '<'`-style failures). A personal Gmail address and a WhatsApp number are baked into the UI.

---

## 7. Data model & scale

| Aspect | Current | Result |
|---|---|---|
| Storage unit | one row per saved report; `data` = entire `ProcessedReport` JSONB | read/list = full payload; no SQL analytics across months |
| Table list query | `select('id, fileName, period, createdAt')` — good | fine |
| Row identity | `id: number` in TS; purge uses `.neq('id', 0)` (`server.ts:106-112`) | wrong for `uuid` PKs (every comparison errors / no-ops), and a "delete all" expressed as "not equal to one value" is fragile; `.delete().neq()` also fails when `id` can be `null` |
| Constraints | none in repo (no `period` uniqueness, no FK to a branch/team dimension) | duplicate months, drift between branch naming in code (`INVNT CAPE TOWN`) and in data |
| Attendance | nested object of 30 keys per record | cannot be queried/indexed; ~30×N JSON overhead per report |
| RLS / migrations | absent from repo | not auditable, not reproducible; schema lives only in someone's dashboard |

At 2 branches × ~200 agents × 30 days the payload is a few MB — acceptable today, but the design blocks the obvious next asks (year-over-year trends, per-agent tenure cohorts, attendance-rate KPIs) which all need row-level data.

**Suggested shape:** `employees(emp_code PK, name, branch, team_id, start_date, end_date, status, category)` + `attendance(emp_code, work_date, code)` + `reports(id, period, branch, file_name, uploaded_by, created_at, warnings jsonb)` with a real FK, a unique `(branch, period)`, and RLS.

---

## 8. Build, dependencies, ops

### O-1 · `npm install` fails on a clean clone 🔴 (verified)

```
npm error path /home/user/Attrition/node_modules/better-sqlite3
npm error command sh -c prebuild-install || node-gyp rebuild --release
npm error gyp ERR! configure error … nodejs.org … ECONNRESET
```
`better-sqlite3` is a **native module that the code never imports** (`grep -r better-sqlite3 src server.ts api` → 0 hits). On any locked-down network, a fresh clone cannot install, so the app cannot be built by a new developer or by CI behind a proxy. Removing it (plus the equally unused `@google/genai` and `autoprefixer`) makes install pure-JS and reproducible. Everything else installed cleanly with `--ignore-scripts` (315 packages) and `tsc`/`vite build` both succeed.

### O-2 · Unused / dead code 🟡

| Item | Evidence |
|---|---|
| `better-sqlite3` | not imported anywhere |
| `@google/genai` | not imported; no Gemini code path; `.env.example` has no key |
| `autoprefixer` | Tailwind v4 via `@tailwindcss/vite`; no PostCSS pipeline |
| `SettingsView` (`:1711-1860`, ~150 lines) | defined once, **never rendered**; calls `/api/settings` and `/api/settings/test`, which do not exist |
| `basedHeadcount` | duplicate of `status` |
| `const PORT = 3000` in `createServer` (`server.ts:18`) | unused, shadows the later `PORT` |
| `Users`, `Calendar` imports | imported, never used |
| `metadata.json`, README | AI Studio scaffolding; README instructs setting `GEMINI_API_KEY` that nothing reads |

`tsc` cannot catch any of the last four because `noUnusedLocals`/`strict` are off (§O-3) and `SettingsView` is a valid (if unreachable) function.

### O-3 · Type-checking is configured but toothless 🟡

`tsconfig.json` has **no `include`/`exclude`** and `strict` off. Verified: `tsc --listFiles` includes `dist/assets/index-*.js` — i.e. `npm run lint` type-checks the build output as well as the source, and `allowJs: true` means a stale `dist/` can change lint results. With `strict` off, `null`/`undefined` flow through the parser unchecked (exactly where `row[idx]` on `-1` matters). Recommendation: `"include": ["src","api","server.ts","vite.config.ts"]`, `"exclude": ["dist","node_modules"]`, `strict: true`, `noUnusedLocals`, plus ESLint + `eslint-plugin-react-hooks` (the one `useCallback` on `onDrop` has an empty dep array while capturing `processExcel`/state).

### O-4 · Bundle size and eager loading 🟡 (measured)

Production build: **1,012.04 kB minified / 313.83 kB gzip, one chunk**, with Vite's own "chunks larger than 500 kB" warning. Forced chunk split for attribution:

| Chunk | Raw | Gzip | Share |
|---|---|---|---|
| `xlsx` | 424.73 kB | 141.75 kB | **42%** |
| app code (`index`) | 261.26 kB | 77.94 kB | 26% |
| `@supabase/supabase-js` | 175.83 kB | 46.14 kB | 17% |
| `motion` | 125.01 kB | 41.38 kB | 12% |
| `lucide-react` (tree-shaken) | 17.91 kB | 5.42 kB | 2% |
| react/react-dom | 3.89 kB | 1.52 kB | — |

Every visitor — including read-only viewers who will never upload or export — downloads the full Excel engine on first paint. `import * as XLSX from 'xlsx'` at the top of `App.tsx` is the fix target: `const XLSX = await import('xlsx')` inside `processExcel`/`downloadReport` alone cuts the initial payload by ~46% and removes the warning.

### O-5 · Server/deployment shape 🟡

`server.ts` is simultaneously a dev server, a prod static server and a Vercel handler; `api/index.ts` calls `createServer()` **per invocation**, and that module imports `vite` (a devDependency) at top level — in a serverless runtime that is either a cold-start tax or a hard failure if devDependencies aren't installed. The listen guard `if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL)` will also start a listener inside any non-Vercel production deployment that imports this module. Recommendation: split `app.ts` (routes only) from `dev-server.ts`, make the Supabase client lazy and fail-fast when unconfigured, and return `503` rather than `500` with an actionable message (`Supabase not configured`).

Related: with no credentials, `/api/reports` returns `500 {"error":"Failed to fetch reports"}` and the dashboard silently shows an empty state (the client logs to console only). The `health` endpoint already knows the truth — surface it as a blocking banner.

### O-6 · Dependency risk 🟡

`npm audit --omit=dev`: **18 vulnerabilities — 2 critical, 11 high, 3 moderate, 2 low.** Notable: `protobufjs` (critical, arbitrary code execution), `proxy-addr` (critical, IP spoofing via IPv4-mapped IPv6), `body-parser`, `path-to-regexp` (ReDoS), `ws` (uninitialised memory disclosure), `vite ≤6.4.3` (dev-server arbitrary file read), `xlsx` (no fix, §S-4). Most are transitively fixable with `npm audit fix`/dependency bumps; the two that need attention are `vite` (dev-only exposure) and `xlsx` (production, untrusted input).

### O-7 · No tests, CI, or observability 🔴

No test files, no test runner, no GitHub Actions, no error boundary, no structured logs, no alerting, no backup/retention policy for `reports`. The only observability is `console.error` on the server and a `console.warn` for missing Supabase config. For a tool whose output feeds staffing decisions, the parser — the most intricate logic in the system — has zero regression coverage and a fixture workbook would take ~30 minutes to create.

---

## 9. UX & accessibility

**Strong:** clear navigation and information hierarchy; branch switcher; explicit "Data Integrity Warning" for `UNASSIGNED`; destructive actions gated behind a styled confirm modal; toasts; sensible empty states.

**Weak:**

- **Typography too small for a data tool.** Tables render at `text-[8px]`–`text-[10px]` (`:1339`, `:1538-1588`) — below WCAG-readable comfort for dense numeric review, and attendance cells are `9px`/`3.5` units.
- **Colour-only encoding.** Status is conveyed by green/amber pills and rate by red/green text with no icon or label; the `>10%` threshold is unexplained in the UI.
- **Icon-only controls** (sidebar collapse, delete, settings) have no `aria-label`; tables lack `<caption>`/`scope`; the login modal is a `<div>` overlay without focus trap, `role="dialog"` or Escape handling.
- `alert('Incorrect passcode')` for a wrong passcode — inconsistent with the app's own modal language.
- **The attendance grid** renders ~31 columns × N rows with no virtualisation, pagination, search, or filter by status/team; 200 agents × 31 days = 6,200 cells re-rendered on every filter change (and the `useMemo`-free `filteredRecords` recomputes on every render).
- **Saving clears the screen.** After a successful save the app calls `setReport(null)` (`:272`) — the user loses the report they were looking at, then a realtime event fires `fetchHistory()` and a "Cloud data updated" toast (also for their own write).
- **No trend view.** The `BarChart3` icon promises analytics that do not exist: no month-over-month line, no comparison of branches, no tenure/cohort breakdown.
- **No raw-data export.** `downloadReport` exports only the two summary sheets; the parsed register (the thing users would sanity-check against the spreadsheet) cannot be downloaded.
- No undo for delete/purge beyond the confirmation dialog, and no soft-delete.

---

## 10. Prioritised recommendations

### P0 — before the next real report is shared (≈1 day)

1. **Remove the client-side secret.** Delete the hard-coded passcode; gate upload with real server auth (Supabase Auth email/password or magic link is the least-effort path given the existing stack). Treat `evidence` that it is in the bundle as the defect, not the JSON.
2. **Authenticate and re-shape the API.** Middleware that verifies a session/JWT on every mutating route; drop `DELETE /api/reports-purge/all` or restrict it to a single `admin` role with a typed confirmation; validate `period` (`^\d{4}-\d{2}$`) and reject oversized/unknown fields; reduce `express.json` limit to ~10 MB.
3. **Fix the attrition definition, once, in one place.** Extract `computeReport(records, {includeIncubation})` into `src/lib/attrition.ts`, use it in the UI *and* the export, and make it:
   ```ts
   const ACTIVE = 1;
   const headcount = rows.filter(r => r.category === 'ACTIVE').length;
   const leavers  = rows.filter(r => r.category !== 'ACTIVE').length;
   const rate     = headcount + leavers === 0 ? null : leavers / (headcount + leavers); // always ≤ 100%
   ```
   Then decide explicitly whether `DROPPED_OUT` (incubation exits) belongs in the same bucket as resignation — and label the metric honestly ("Proportion of register inactive" vs "Attrition rate").
4. **Add uniqueness.** Unique `(branch, period)` on `reports` (or an explicit "replace existing report for this period?" prompt), and make `id` handling consistent (`uuid`).
5. **Delete the three unused dependencies** (`better-sqlite3`, `@google/genai`, `autoprefixer`) so `npm install` works on a clean, proxied machine.

### P1 — make the numbers trustworthy (≈3–5 days)

6. **Extract the parser into a pure, tested module** (`src/lib/parseRegister.ts`) returning `{ records, warnings[] }`. Add fixture workbooks (happy path, missing day window, renamed team, duplicate emp code, no `TEAM` column, ALPHA-only) and unit tests for each `warnings` case. Require the UI to *display* the warnings rather than only counting `UNASSIGNED`.
7. **Stop guessing the period.** Show the filename-derived period in an editable field with confirmation before processing; store `uploaded_at`, `period`, `branch` (currently the branch is only implicit inside records) and `warnings` with the report.
8. **Filter terminations by the reporting window** and distinguish *future-dated contract end* from *terminated in period*.
9. **Stabilise team attribution.** Prefer an explicit `TEAM` column value, normalise it through a lookup table (config file or DB table, not `includes('MOSES')`), and fail loudly (warning row) when a record has no team, instead of inheriting the previous heading's team.
10. **Fix the toolchain.** `include`/`exclude` in `tsconfig`, `strict: true`, ESLint + `react-hooks`; rewrite the README (Supabase env vars, `API` tables, how to run against a fresh project); delete `SettingsView` and the Support copy about e-mail reminders, or implement them in a Vercel Cron job.
11. **Lazy-load SheetJS** (`await import('xlsx')`) and add an error boundary — initial payload drops from ~314 kB to ~170 kB gzip.
12. **Split `App.tsx`** into `features/{dashboard,upload,history,report}` + `components/`. At 1,946 lines with four copies of the formula block, every change currently risks silent divergence.

### P2 — product value & hardening (≈2 weeks)

13. **Model the data relationally** (employees / attendance / reports) with migrations in-repo, RLS enabled, and `reports` removed from anon realtime payloads; add a monthly aggregate view so trends are a SQL query, not a client loop.
14. **Add the trend view the icon already promises:** month-over-month attrition by branch/team, with the metric definition printed next to the chart.
15. **Raw export + audit trail:** download the parsed register (CSV) alongside the summary; record who saved which report; soft-delete with restore.
16. **Accessibility pass:** ≥11 px table type (ideally 12–13 px with density toggle), icon labels, keyboard-traversable modal, status conveyed by icon + text, `scope`/`caption` on tables.
17. **CI:** `npm ci && tsc --noEmit && vitest run && vite build` on PRs; `npm audit` gate; Dependabot for `vite`, `ws`, `body-parser`, `path-to-regexp`, `protobufjs`.
18. **Operate it:** structured request logs, an error reporter, a nightly Supabase backup, and a `/api/health` check that includes database reachability.

---

## 11. Verified evidence (reproduction notes)

All commands run in a clean checkout of `bbae3a3` with Node 22.22.3 / npm 10.9.8.

```bash
# 1. Clean install fails on the unused native dependency
npm install
#  → npm error path .../node_modules/better-sqlite3
#  → gyp ERR! configure error ... nodejs.org ... ECONNRESET
npm install --ignore-scripts        # succeeds: "added 315 packages"

# 2. Type-check and production build both pass
npx tsc --noEmit            # exit 0, 0 diagnostics (but includes dist/assets/*.js in the program)
npx vite build              # 1,012.04 kB │ gzip: 313.83 kB  (single chunk, >500 kB warning)

# 3. The "admin" secret ships in the bundle
grep -o "ak_2026!" dist/assets/*.js     # → ak_2026!

# 4. Runtime smoke test without credentials
npx tsx server.ts & curl localhost:4173/api/health
#  → {"status":"ok","supabaseConfigured":false}
curl -X DELETE localhost:4173/api/reports-purge/all
#  → 500 {"error":"Failed to purge reports"}   (accepted with no auth; fails only on missing DB)
curl localhost:4173/api/settings
#  → 200 text/html   (SPA fallback: the endpoint SettingsView calls does not exist)

# 5. Dependency risk
npm audit --omit=dev        # 18 vulnerabilities (2 critical, 11 high, 3 moderate, 2 low)

# 6. Chunk attribution (temporary manualChunks config, then removed)
#  xlsx 424.73 kB (141.75 gzip) · app 261.26 kB · supabase 175.83 kB · motion 125.01 kB

# 7. Unused-code confirmation
grep -rn "better-sqlite3\|@google/genai" src server.ts api | wc -l   # 0
grep -c "SettingsView" src/App.tsx                                  # 1 (definition only)
```

No application source files were modified for this analysis; the temporary build config and `dist/` output were removed afterwards.

---

## 12. Bottom line

The hard part of this product is not the UI — it is *deciding what "attrition" means for this floor and making the spreadsheet-to-KPI path provable*. Right now the app makes that decision implicitly (in four slightly different places) and guesses the structure of the input, while the only thing standing between a stranger and the entire history is a string comparison in the browser.

Fix the three P0s — real auth on writes, one honest metric, deduplicated/unblocked dependencies — and this becomes a genuinely useful internal tool. Then invest in tests around the parser: that is where the trust lives.
