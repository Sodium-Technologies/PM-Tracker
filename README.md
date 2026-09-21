# CKO PM Payroll

A dynamic payroll app for the property-management freelance book — replaces the
`PM_Mastersheet.xlsx` monthly tabs with a live calculator.

Nothing is hard-coded: accounts, team members, rates, platform fees, the
freelancer/company split and every division share are data you edit in the app,
per period.

## What it does

1. **Revenue** — one row per client account. Enter the rate and the individual
   time entries (`20 + 20 + 20 + 20`, just like the sheet). The app computes
   gross, the fee deduction, one-off adjustments, earned, the PKR conversion,
   and the team/company split. An account can be billed in USD or settled
   directly in PKR (click the currency tag on the rate), and a fixed line is
   simply a rate with a single unit.
2. **Division** — a staff × account matrix of percentage shares of each
   account's freelancer pool. Columns that don't add to 100% are flagged, with
   the unassigned amount shown in PKR.
3. **Payouts & settlement** — per-person payout register (PKR and USD with the
   per-account breakdown and manual corrections), **wages paid here**,
   reimbursements, payables outside the matrix, amounts held back, transfers
   already made, and what still has to be remitted.

### Wages paid here, and advances

Somebody on the payroll can take money during the month. It comes off **their
own pay first** — it is an advance on the salary, not money on top of it. Enter
it under **Taken already** on the Payrolls tab, against that person.

From there the split is automatic:

- Taken less than their pay → all of it is an advance. **Still owed** shows what
  is left of their salary.
- Taken exactly their pay → the salary is used up, nothing owed, no draw.
- Taken more than their pay → the excess is a **draw**: money beyond what they
  earned this month. The row turns and the month carries a warning naming the
  person and the amount.

Ticking **You pay them** means that person's whole pay is handed over on this
side, so it never has to be remitted. An advance is then part of that pay, not
an extra deduction — someone marked this way who has also taken an advance is
counted once, and only a draw beyond their pay adds to it.

"You paid this yourself" on the Distributions tab is for wages paid by hand to
somebody with no share of a client. A person on the payroll belongs in **Taken
already**, so their pay and what they have had of it stay in one place.

## Working with periods

- **+ Next period** rolls the current month forward: accounts, team and every
  split carry over, while hours, adjustments, status and transfers reset.
- **Import sheet** reads an existing mastersheet. Each month tab is parsed by
  header name (not by fixed column letters), including the division matrix,
  reimbursements and prior transfers.
- **Export Excel** writes one sheet per period plus a summary; **Export
  payouts** writes the payout register for the open period.
- **Backup** downloads the whole dataset as JSON.

Data is stored in the browser (`localStorage`) — it never leaves the machine.
Export or back up before switching devices.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static bundle in dist/
```

## The mark

`public/icon.svg` is the drawing everything else comes from: the browser tab
icon, `favicon.ico`, the home-screen icon, and — redrawn inline in
`src/components/Mark.tsx`, so it picks up the page's own font — the mark in the
rail and on the sign-in screen. Change the SVG, then run
`node scripts/icons.mjs` to render the PNG and `.ico` files again.

The mark's teal is `--brand` in `src/styles.css`, and every neutral in the
palette is mixed towards it. It does not change between light and dark — the
logo is one object — while `--accent` is its readable form on each paper.

## Sharing it with other people

Without any configuration the app is a local tool: whatever is in your browser is
yours, and there is nothing to sign in to. Point it at a Supabase project and it
becomes a shared book with real accounts and roles.

| Role | Can do |
|---|---|
| Administrator | edit the books **and** decide who has access |
| Can edit | edit the books |
| View only | read every figure, change nothing |

Access is by email address. Someone you add signs in with a one-time link sent to
that address — no passwords to set, forget, or leak. An address that is not on the
list sees nothing: **the database refuses the data, not just the page.** That
distinction matters — a login screen on a static site is decoration, because
anything the browser receives can be read. Here the rules live in Postgres
row-level security, so a viewer who opens dev tools and calls the API directly
still cannot write, and a stranger gets an empty result.

### Setting it up

1. Create a project at supabase.com.
2. Open **SQL Editor → New query**, paste `supabase/schema.sql`, change the email
   at the bottom to the address you sign in with, and run it.
3. In **Authentication → URL Configuration**:
   - set **Site URL** to your deployed address (`https://your-site.netlify.app`).
     It defaults to `http://localhost:3000`, and a sign-in link sent while that
     default is in place lands on a page nothing serves — the classic
     "localhost refused to connect" after clicking the email.
   - add the same address under **Redirect URLs**.
4. Recommended: set up your own SMTP, then send a six-digit code instead of a
   link.

   Since June 2026 a free project on Supabase's built-in email service **cannot
   edit its auth email templates** — the stock Magic Link mail carries only
   `{{ .ConfirmationURL }}`, so there is no code in it. Configuring custom SMTP
   restores template editing on any plan, free included, and lifts the built-in
   service's limit of a couple of messages an hour.

   Any provider with a free tier will do, but **without a domain of your own,
   use Brevo**: it verifies a single sender address with a code emailed to it,
   where Resend's sandbox sender (`onboarding@resend.dev`) delivers only to the
   Resend account holder — everyone else gets nothing, silently.

   In Brevo: add and verify the sender under **Senders, Domains & Dedicated
   IPs**, then take a key from **SMTP & API → SMTP → Generate a new SMTP key**
   (an SMTP key, not an API key), and note the **Login** shown on that tab.
   Then, in Supabase's **Project Settings → Authentication → SMTP Settings**:

   ```
   Sender email   the address you verified
   Sender name    CKO PM Payroll
   Host           smtp-relay.brevo.com
   Port           587
   Username       the Login from the SMTP tab
   Password       the SMTP key
   ```

   Sending from a free mailbox rather than a domain you control means no aligned
   SPF or DKIM, so the first few messages may land in spam. Check there before
   concluding nothing was sent.

   Then, in **Authentication → Emails → Magic Link**:

   ```html
   <h2>Sign in to CKO PM Payroll</h2>
   <p>Your code is <b>{{ .Token }}</b> — type it into the page that asked for it.</p>
   ```

   Leaving `{{ .ConfirmationURL }}` out entirely is the point: with no link in
   the email there is nothing to tap, nothing opens a second window, and a phone
   home-screen app works like everything else.

   Without custom SMTP the app still works — the email has only a link, and the
   sign-in screen takes a pasted link as well as a code.

   Either way the app finishes the sign-in itself, in the window that asked for
   it. Pasting the link rather than clicking it is what makes it work from a
   home-screen app, and from a browser other than the one that requested it. A
   link still cannot survive a mail scanner opening it first — Outlook's link
   protection routinely consumes one-time links — and in that case a new one, or
   a code, is the way through.

5. Set two environment variables in Netlify (**Site configuration → Environment
   variables**), from **Project Settings → API**:

   ```
   VITE_SUPABASE_URL       https://<project>.supabase.co
   VITE_SUPABASE_ANON_KEY  <the anon / publishable key>
   ```

   The anon key is designed to be public; it grants nothing on its own.
6. Redeploy. Sign in as yourself, open **Access**, and add your partner's email
   as *View only* or *Can edit*.
7. Load the books once — *Import sheet or backup* — and they are shared with
   everyone who has access.

### On a phone home screen

Open the site in Safari, **Share → Add to Home Screen**. It installs as its own
app: full screen, its own icon, no browser chrome.

Do not **tap** the sign-in link there. A home-screen app on iOS is a separate
app with its own storage, and it can never be what a link from Mail opens —
tapping it hands the sign-in to Safari, a different app, and this one never sees
it.

Instead, in the email press and hold the sign-in button, choose **Copy Link**,
and paste it into the box on the sign-in screen. The app reads the token out of
the link and verifies it itself, so the sign-in finishes in the window that
asked for it. A six-digit code, if the template sends one, works the same way.

The same paste is worth using in a browser: clicking the link opens a second
copy of the app, because the link's destination *is* the app and that new tab is
what performs the exchange, with the original tab picking the session up behind
it. Pasting skips all of that.

### If the email never arrives

Supabase's built-in email service is rate-limited to a handful of messages an
hour and is meant for testing. For real use, set your own SMTP under **Project
Settings → Authentication → SMTP Settings** — any provider will do. Until then,
expect delays and silent drops once you have sent a few.

Both keys absent, the app falls back to browser storage and behaves exactly as it
did before, which is what keeps the local copy and the preview working.

## Deploying

`netlify.toml` is set up: build `npm run build`, publish `dist`.

**From GitHub (recommended).** In Netlify, *Add new site → Import an existing
project*, pick this repository and the branch. Netlify reads `netlify.toml`, so
there is nothing to configure, and every push redeploys.

**By hand.** Run `npm run build` and drag the `dist` folder onto
app.netlify.com/drop.

### Starting a deployment with data in it

A fresh browser loads `./seed.json` from the site if one is there, so the app can
open on real periods instead of an empty month:

```bash
npm run seed -- public/seed.json <mastersheet.xlsx> [corrected.xlsx ...]
npm run build          # seed.json is copied into dist/
```

Later files win where two workbooks carry the same month, so name the corrected
one last.

`seed.json` is **not** in the repository, and the ignore rule keeps it out. That
is deliberate: a Netlify site is public to anyone with the URL, and the seed
holds client names, rates and payouts. Ship it only if the site is protected
(Netlify's password protection or an access control), or leave it out and import
the same file once through *Import sheet or backup* — the data then lives in your
browser and never reaches the web.

## Checking it still works

`scripts/e2e.mjs` drives the built app in a real browser: it imports a
mastersheet, exercises the Excel, payout and JSON exports, reads the exported
files back, then checks roll-forward, delete, reload persistence and the
allocation display.

```bash
npm run build
npm run e2e -- /path/to/PM_Mastersheet.xlsx
```

`scripts/e2e-auth.mjs` checks the access rules the page enforces — signed out,
signed in without access, viewer, editor, administrator — against a build
configured for Supabase, with Supabase itself stubbed at the network boundary:

```bash
VITE_SUPABASE_URL=https://stub.supabase.co VITE_SUPABASE_ANON_KEY=stub-key npm run build
npm run e2e:auth
```

It proves what the page does with each answer. What the *database* allows is
`supabase/schema.sql`, and is enforced there whatever the page renders.

## How time is read

A month reads its time column one of two ways, set in the header:

- **12.20 = 12 hours 20 minutes** — a timesheet's notation. `12.2030` is
  12 h 20 m 30 s; `12` is 12 hours. Minutes above 59 are flagged rather than
  quietly converted. This is the default for a month started in the app.
- **12.20 = 12.2 hours** — plain decimal hours. Months imported from a
  spreadsheet keep this, because a sheet that multiplied a rate by 12.2 meant
  12.2 hours; reading those numbers the other way would change every figure that
  has already been agreed.

Switching a month between the two changes what it earns. That is the point of
making it explicit.

## Money that never reaches you

Three different reasons an amount does not need sending, each recorded rather
than quietly netted off:

| On the page | What it means |
|---|---|
| Went straight to the company | the client paid the company's account directly, so neither the team's part nor the company's part passed through you |
| You paid it yourself | wages you handed over here — a person marked *You pay them*, plus anything drawn on top |
| Kept back this month | held rather than sent |

## Calculation reference

Nothing is rounded while it is being worked out — figures keep full precision
through the whole chain and are rounded once, where they are read. Rounding a
number mid-calculation carries its error into every total built on it.

Per account, in that account's own currency:

```
units          = sum(time entries)
gross          = rate × units
earned         = gross − gross × feePct + adjustment
freelancerPool = earned × freelancerPct        (company = earned − pool)
```

An account priced in USD converts once, at the period's rate; one settled in PKR
never touches the conversion at all.

Per person, and then for the period:

```
pay            = Σ over accounts (freelancerPool_PKR × share) + manual adjustment
owed           = Σ pay + payables outside the matrix + company share
still to remit = owed − reimbursements − pay kept local − held back − transfers made
```

Reimbursements are **subtracted**: that money was already spent on the receiving
side, so it never has to travel. The same goes for pay that stays where it is and
anything deliberately held back.

## Reconciliation

The importer is checked against every month tab of the mastersheet. Earned-PKR
and per-person pay match the sheet on all of them, to the rupee, except one cell:
January's Nick row, where the sheet hard-codes a PKR figure converted at three
different rates. The app flags that in the row's notes instead of silently
disagreeing — switch that account to PKR if you want the exact figure.

The September 2026 layout — a separate **Fee Deduction** column holding the fee
as a fraction — is read directly when present, so editing the hours afterwards
keeps the fee the user set rather than re-deriving it.
