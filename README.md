# PM Payroll

A dynamic payroll app for the property-management freelance book — replaces the
`PM_Mastersheet.xlsx` monthly tabs with a live calculator.

Nothing is hard-coded: accounts, team members, rates, platform fees, the
freelancer/company split and every division share are data you edit in the app,
per period.

## What it does

1. **Revenue** — one row per client account. Enter the rate and the individual
   time entries (`20 + 20 + 20 + 20`, just like the sheet). The app computes
   gross, the platform/agency fee, one-off adjustments, earned, the PKR
   conversion, and the freelancer/company split. An account can be billed in USD
   or settled directly in PKR, and a fixed line can simply carry an invoiced
   amount.
2. **Division** — a staff × account matrix of percentage shares of each
   account's freelancer pool. Columns that don't add to 100% are flagged, with
   the unassigned amount shown in PKR.
3. **Payouts & settlement** — per-person payout register (PKR and USD with the
   per-account breakdown, plus manual corrections and a "kept local" flag),
   reimbursements, payables outside the matrix, amounts held back, transfers
   already made, and what still has to be remitted.

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

## Calculation reference

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

The importer was checked against every month tab of the mastersheet. Earned-PKR
and per-person pay match the sheet on all of them, to the rupee, except one cell:
January's Nick row, where the sheet hard-codes a PKR figure converted at three
different rates. The app flags that in the row's notes instead of silently
disagreeing — enter it as a PKR-denominated account if you want the exact figure.
