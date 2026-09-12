# PM Payroll

A dynamic payroll app for the property-management freelance book — replaces the
`PM_Mastersheet.xlsx` monthly tabs with a live calculator.

Nothing is hard-coded: accounts, team members, rates, platform fees, the
freelancer/company split and every division share are data you edit in the app,
per period.

## What it does

1. **Revenue** — one row per client account. Enter the rate and the individual
   time entries (`20 + 20 + 20 + 20`, just like the sheet). The app computes
   gross, the platform/agency fee, one-off adjustments, earned USD, the PKR
   conversion, and the freelancer/company split.
2. **Division** — a staff × account matrix of percentage shares of each
   account's freelancer pool. Columns that don't add to 100% are flagged, with
   the unassigned amount shown in PKR.
3. **Payouts & settlement** — per-person payout register (PKR and USD with the
   per-account breakdown), reimbursements, transfers already made, and what is
   left to send.

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

```
units          = sum(time entries)
gross          = rate × units
fee            = gross × feePct
earned         = gross − fee + adjustment
freelancerPool = earned × freelancerPct       (company = earned − pool)
staff pay      = Σ over accounts of (freelancerPool_account × PKR rate × share)
transferable   = staff pay + company share + reimbursements
remaining      = transferable − transfers made − settled reimbursements
```

## Note on compliance

The app is a bookkeeping calculator for contractor payouts; it does not compute
tax withholding. Payments to non-employee contractors, 1099/W-8BEN handling for
US-based clients, and Maryland/DC contractor-classification rules remain a
separate check before money moves.
