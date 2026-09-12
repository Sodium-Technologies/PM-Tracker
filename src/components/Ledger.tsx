import type { LineItem, Period } from '../lib/types';
import { fmtPkr, fmtUsd, round2, type PeriodResult } from '../lib/calc';
import { NumberInput, TextInput } from './Fields';
import { uid } from '../lib/state';
import { exportPayoutSheet } from '../lib/xlsx';

type Update = (fn: (p: Period) => void) => void;

export default function Ledger({ period, result, update }: {
  period: Period; result: PeriodResult; update: Update;
}) {
  const L = result.ledger;

  return (
    <div className="grid-2">
      <section className="panel">
        <div className="panel-head">
          <h2>Payout register</h2>
          <button className="btn" onClick={() => exportPayoutSheet(period)}>Export payouts</button>
        </div>
        <div className="scroll">
          <table className="simple">
            <thead>
              <tr>
                <th>Name</th>
                <th className="r">From shares</th>
                <th>Adjustment</th>
                <th className="r">Pay PKR</th>
                <th className="r">USD</th>
                <th title="Pay that stays where it is — still owed, but not part of the money to remit">Kept local</th>
              </tr>
            </thead>
            <tbody>
              {result.staff.map((s) => (
                <tr key={s.staff.id}>
                  <td>
                    {s.staff.name}
                    <div className="muted small">
                      {Object.entries(s.byAccount)
                        .map(([id, v]) => `${period.accounts.find((a) => a.id === id)?.name ?? ''} ${Math.round(v).toLocaleString()}`)
                        .join(' · ') || '—'}
                    </div>
                  </td>
                  <td className="r mono">{fmtPkr(s.sharePkr)}</td>
                  <td>
                    <NumberInput value={s.staff.adjustmentPkr} width={90}
                      onChange={(v) => update((d) => {
                        const m = d.staff.find((x) => x.id === s.staff.id); if (m) m.adjustmentPkr = v;
                      })} />
                  </td>
                  <td className="r mono strong">{fmtPkr(s.payPkr)}</td>
                  <td className="r mono">{fmtUsd(s.payUsd)}</td>
                  <td>
                    <label className="check">
                      <input type="checkbox" checked={s.staff.retained} onChange={(e) => update((d) => {
                        const m = d.staff.find((x) => x.id === s.staff.id); if (m) m.retained = e.target.checked;
                      })} />
                    </label>
                  </td>
                </tr>
              ))}
              {!result.staff.length && <tr><td colSpan={6} className="empty">No team members yet.</td></tr>}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="r mono">{fmtPkr(round2(result.totals.staffPayPkr - sumAdj(period)))}</td>
                <td className="r mono">{fmtPkr(sumAdj(period))}</td>
                <td className="r mono">{fmtPkr(result.totals.staffPayPkr)}</td>
                <td className="r mono">{fmtUsd(round2(result.totals.staffPayPkr / (period.usdToPkr || 1)))}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        {result.totals.unallocatedPkr !== 0 && (
          <p className="note warn-text">
            {fmtPkr(result.totals.unallocatedPkr)} of the freelancer pool is not assigned to anyone
            in the division matrix.
          </p>
        )}
      </section>

      <div className="stack">
        <section className="panel">
          <h2>Settlement (PKR)</h2>
          <dl className="kv">
            <div><dt>Team payouts</dt><dd>{fmtPkr(result.totals.staffPayPkr)}</dd></div>
            <div><dt>Payables outside the matrix</dt><dd>{fmtPkr(L.otherPayablesPkr)}</dd></div>
            <div><dt>Company share</dt><dd>{fmtPkr(result.totals.companyPkr)}</dd></div>
            <div className="rule"><dt>Owed this period</dt><dd>{fmtPkr(L.transferablePkr)}</dd></div>
            <div><dt>Less reimbursements already covered</dt><dd>−{fmtPkr(L.reimbursementsPkr)}</dd></div>
            <div><dt>Less pay kept local</dt><dd>−{fmtPkr(L.retainedPkr)}</dd></div>
            <div><dt>Less held back</dt><dd>−{fmtPkr(L.withheldPkr)}</dd></div>
            <div><dt>Less already transferred</dt><dd>−{fmtPkr(L.transfersPkr)}</dd></div>
            <div className="total"><dt>Still to remit</dt><dd>{fmtPkr(L.remainingPkr)}</dd></div>
          </dl>
        </section>

        <LineItems title="Reimbursements (USD, already spent on that side)" period={period}
          rows={period.reimbursements.map((r) => ({ id: r.id, label: r.label, amountPkr: round2(r.amountUsd * period.usdToPkr) }))}
          usd={period.reimbursements}
          onAdd={() => update((d) => d.reimbursements.push({ id: uid(), label: 'Expense', amountUsd: 0 }))}
          onLabel={(id, v) => update((d) => { const x = d.reimbursements.find((y) => y.id === id); if (x) x.label = v; })}
          onAmount={(id, v) => update((d) => { const x = d.reimbursements.find((y) => y.id === id); if (x) x.amountUsd = v; })}
          onRemove={(id) => update((d) => { d.reimbursements = d.reimbursements.filter((y) => y.id !== id); })}
        />

        <LineItems title="Payables outside the matrix" period={period}
          rows={period.otherPayables}
          onAdd={() => update((d) => d.otherPayables.push({ id: uid(), label: 'Name', amountPkr: 0 }))}
          onLabel={(id, v) => update((d) => { const x = d.otherPayables.find((y) => y.id === id); if (x) x.label = v; })}
          onAmount={(id, v) => update((d) => { const x = d.otherPayables.find((y) => y.id === id); if (x) x.amountPkr = v; })}
          onRemove={(id) => update((d) => { d.otherPayables = d.otherPayables.filter((y) => y.id !== id); })}
        />

        <LineItems title="Held back this period" period={period}
          rows={period.withheld}
          onAdd={() => update((d) => d.withheld.push({ id: uid(), label: 'Kept', amountPkr: 0 }))}
          onLabel={(id, v) => update((d) => { const x = d.withheld.find((y) => y.id === id); if (x) x.label = v; })}
          onAmount={(id, v) => update((d) => { const x = d.withheld.find((y) => y.id === id); if (x) x.amountPkr = v; })}
          onRemove={(id) => update((d) => { d.withheld = d.withheld.filter((y) => y.id !== id); })}
        />

        <section className="panel">
          <div className="panel-head">
            <h2>Transfers made</h2>
            <button className="btn" onClick={() => update((d) => d.transfers.push({
              id: uid(), label: 'Transfer', amountPkr: 0, date: new Date().toISOString().slice(0, 10),
            }))}>+ Add</button>
          </div>
          <table className="simple">
            <tbody>
              {period.transfers.map((t) => (
                <tr key={t.id}>
                  <td><TextInput value={t.label} width={130}
                    onChange={(v) => update((d) => { const x = d.transfers.find((y) => y.id === t.id); if (x) x.label = v; })} /></td>
                  <td><input className="cell-input" type="date" value={t.date}
                    onChange={(e) => update((d) => { const x = d.transfers.find((y) => y.id === t.id); if (x) x.date = e.target.value; })} /></td>
                  <td><NumberInput value={t.amountPkr} width={110} suffix="PKR"
                    onChange={(v) => update((d) => { const x = d.transfers.find((y) => y.id === t.id); if (x) x.amountPkr = v; })} /></td>
                  <td><button className="btn ghost danger" onClick={() => update((d) => {
                    d.transfers = d.transfers.filter((y) => y.id !== t.id);
                  })}>×</button></td>
                </tr>
              ))}
              {!period.transfers.length && <tr><td className="empty">Nothing sent yet.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

const sumAdj = (p: Period) => round2(p.staff.reduce((a, s) => a + (Number(s.adjustmentPkr) || 0), 0));

function LineItems({ title, rows, usd, period, onAdd, onLabel, onAmount, onRemove }: {
  title: string;
  rows: LineItem[];
  usd?: { id: string; amountUsd: number }[];
  period: Period;
  onAdd: () => void;
  onLabel: (id: string, v: string) => void;
  onAmount: (id: string, v: number) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <button className="btn" onClick={onAdd}>+ Add</button>
      </div>
      <table className="simple">
        <tbody>
          {rows.map((r) => {
            const u = usd?.find((x) => x.id === r.id);
            return (
              <tr key={r.id}>
                <td><TextInput value={r.label} onChange={(v) => onLabel(r.id, v)} width={150} /></td>
                <td>
                  {u
                    ? <NumberInput value={u.amountUsd} onChange={(v) => onAmount(r.id, v)} suffix="USD" />
                    : <NumberInput value={r.amountPkr} onChange={(v) => onAmount(r.id, v)} width={110} suffix="PKR" />}
                </td>
                <td className="r mono muted">{u ? fmtPkr(round2(u.amountUsd * period.usdToPkr)) : ''}</td>
                <td><button className="btn ghost danger" onClick={() => onRemove(r.id)}>×</button></td>
              </tr>
            );
          })}
          {!rows.length && <tr><td className="empty">None.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
