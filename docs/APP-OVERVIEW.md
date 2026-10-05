# CKO PM Payroll — app overview (context for an AI assistant)

A payroll ledger for a property-management bookkeeping team: what each client
earned, what each team member is owed, and what is left to send. Amounts are in
USD and PKR.

## Stack and hosting
- Vite + React 18 + TypeScript single-page app; no server code of its own.
- Netlify deploys every push to `main` (repo `Sodium-Technologies/PM-Tracker`).
- Supabase (Postgres + Auth + Realtime) via `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY`. Without them the app runs in local mode: no
  sign-in, data kept in that browser only.
- The footer shows the build version (commit and date); a banner offers a
  reload when a newer build is deployed.

## Authentication
- Email one-time code only (six digits) via `signInWithOtp` / `verifyOtp`; no
  magic links. This works in the iOS home-screen app, whose storage is
  separate from Safari's.
- Email is sent through Brevo as custom SMTP; the templates use `{{ .Token }}`.
- After sign-in, the address is looked up in `app_users`. An address that is
  not listed sees nothing.

## Roles (`app_users.role`)
| UI label    | DB value      | Access |
|-------------|---------------|--------|
| Super admin | `super_admin` | Everything; can set months to "Only me"; manages Access |
| Admin       | `editor`      | Edits the books; Core and Team months |
| Team        | `viewer`      | Must be linked to a payroll person (`app_users.staff_name`); sees only that person's pay |

## Month visibility ("Seen by")
- `private` (Only me): only the month's owner (`owner_email`), not even other
  admins. Only a super admin can set it.
- `core`: super admins and admins.
- `public` (Team): admins see the whole month; each team member sees only
  their own summary.

All of this is enforced by Postgres row-level security, not by the page:
- `member_role()` and `member_staff_name()` are security-definer helpers.
- `effective_visibility(visibility, data)` returns the narrower of the column
  and the copy inside `data`, so a mismatch fails closed.
- `can_see_period()`, `may_set_visibility()` and `team_pay_readable()` back
  the policies.
- The trigger `touch_updated_at` stamps `updated_at`, `updated_by` and
  `owner_email`. A month moved to private becomes owned by whoever moved it.

## Tables
- `app_users(email, role, staff_name, created_at, created_by)`. A team member
  must have a `staff_name` (check constraint).
- `periods(id, label, data jsonb, visibility, owner_email, updated_at, updated_by)`:
  one row per month, with the whole month as JSON in `data`.
- `team_pay(period_id, member, label, summary jsonb)`: one summary per person
  per month. The app rewrites it whenever an admin saves a month. A summary
  holds projects (name, hours, share %, earned PKR/USD), pay, amount taken
  and amount still owed. It never includes rates, revenue or other people's
  pay.

## Data model (`Period`, stored in `periods.data`)
- `label`, `usdToPkr`, `timeFormat` (`hm`: 12.20 = 12h20m, or `decimal`).
- `accounts[]` (clients/projects): name, owner, currency, rate, `entries[]`
  (weekly hours), `feePct`, `adjustmentUsd`, `freelancerPct`, status,
  `receivedAmount` (null means follow the status), `aliases[]`, `paidDirect`
  and notes.
- `staff[]`: name, `shares{accountId: 0..1}`, `adjustmentPkr`, `retained`
  (paid here), `advancePkr` (already taken) and notes.
- `reimbursements[]`, `otherPayables[]`, `withheld[]`, `localWages[]`,
  `transfers[]`.
- `visibility` and `ignoredProjects[]`.

## Calculations (`src/lib/calc.ts`)
- Earned = rate × hours − fee + adjustment.
- Team pool = earned × `freelancerPct`; the company keeps the remainder.
- Received follows the status unless `receivedAmount` is typed in.
- Pay = sum of (pool × share) + adjustment. Money taken comes off pay first
  (an advance); only the excess is a draw.
- Left to send = received − reimbursements − local wages − withheld −
  transfers.
- Full precision throughout; rounding happens only at display, and −0 is
  shown as 0.

## Screens
- **Dashboard**, across all months: totals, a monthly bar chart with a
  3-month average, revenue by client, each client over time.
- **Month**, with four tabs:
  - Summary
  - Revenue (client column pinned when scrolling sideways)
  - Payrolls (team members, with pay in USD)
  - Distributions (transfers and the left-to-send ledger)
- **Month header**: the month's name, USD→PKR rate, time format, Seen by,
  Undo (also Ctrl/Cmd+Z, for the current session), Duplicate and Delete.
- **Settings**: Load a sheet, Save a backup, and Access (super admin only;
  picking Team requires choosing a person).
- **Team view**: a team member's only screen. Total earned, still owed, pay
  by project, and a month-by-month breakdown.

## Imports and exports
- Excel mastersheet (.xlsx): each sheet with payroll data becomes a month.
- Backup (.json): restores every month (`{version, periods, activePeriodId}`).
- Upwork transactions CSV, in the open month:
  1. Pairs each Hourly row with its Service Fee row by Transaction ID, and
     works out hours, rate and fee % for each client.
  2. You pick a week.
  3. Each project is matched to a client: a remembered alias first, then an
     exact name, then a close name; an ambiguous match counts as no match.
     You can choose an existing client, add a new one, leave it out this
     once, or never import that project.
  4. For each client: Add, Replace or Leave it out.
  5. Only the open month changes; aliases and ignored projects are
     remembered.
- Exports: Download as Excel, and Save a backup.

## Code layout
```
src/App.tsx            shell, views, undo, saving and syncing
src/components/        AccountsTable, DivisionMatrix, Ledger, Overview, Analytics,
                       People (Access), TeamView, WeekImport, SignIn, Fields, Mark
src/lib/               calc, cloud (Supabase I/O), team (team_pay), auth, week (CSV),
                       xlsx, time, state, types, freshness, supabase
supabase/              schema.sql, team-access.sql, fix-owner-trigger.sql,
                       repair-visibility.sql, diagnose-*.sql
scripts/               rls-checks.sh (26 checks on real Postgres), e2e-auth.mjs
                       (58 browser checks), e2e-week.mjs, week-checks.mts, e2e-fresh.mjs
```

## Conventions
- Never commit payroll data (`seed.json` and backups are gitignored).
- Supabase SQL uses named dollar quotes (`$fn_x$`) and is safe to run more
  than once.
- Plain-English UI copy; no jargon.
