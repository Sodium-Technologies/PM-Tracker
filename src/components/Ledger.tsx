import type { Period } from '../lib/types';
import { fmtPkr, fmtUsd, round2, type PeriodResult } from '../lib/calc';
import { NumberInput, TextInput } from './Fields';
import { uid } from '../lib/state';
import { exportPayoutSheet } from '../lib/xlsx';

export default function Ledger({ period, result, update }: {
  period: Period;
  result: PeriodResult;
  update: (fn: (p: Period) => void) => void;
}) {
  const L = result.ledger;
  return (
    <div className="grid-2">
      <section className="panel">
        <div className="panel-head">
          <h2>Payout register</h2>
          <button className="btn" onClick={() => exportPayoutSheet(period)}>Export payouts</button>
        </div>
        <table className="simple">
          <thead>
            <tr><th>Name</th><th className="r">PKR</th><th className="r">USD</th><th>From</th></tr>
          </thead>
          <tbody>
            {result.staff.map((s) => (
              <tr key={s.staff.id}>
                <td>{s.staff.name}</td>
                <td className="r mono strong">{fmtPkr(s.payPkr)}</td>
                <td className="r mono">{fmtUsd(s.payUsd)}</td>
                <td className="muted small">
                  {Object.entries(s.byAccount)
                    .map(([id, v]) => `${period.accounts.find((a) => a.id === id)?.name ?? ''} ${Math.round(v).toLocaleString()}`)
                    .join(' · ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="r mono">{fmtPkr(result.totals.staffPayPkr)}</td>
              <td className="r mono">{fmtUsd(round2(result.totals.staffPayPkr / (period.usdToPkr || 1)))}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </section>

      <div className="stack">
        <section className="panel">
          <div className="panel-head">
            <h2>Reimbursements</h2>
            <button className="btn" onClick={() => update((d) => d.reimbursements.push({
              id: uid(), label: 'Expense', amountUsd: 0, settled: false,
            }))}>+ Add</button>
          </div>
          <table className="simple">
            <tbody>
              {period.reimbursements.map((r) => (
                <tr key={r.id}>
                  <td><TextInput value={r.label} onChange={(v) => update((d) => {
                    const x = d.reimbursements.find((y) => y.id === r.id); if (x) x.label = v;
                  })} width={160} /></td>
                  <td><NumberInput value={r.amountUsd} onChange={(v) => update((d) => {
                    const x = d.reimbursements.find((y) => y.id === r.id); if (x) x.amountUsd = v;
                  })} suffix="USD" /></td>
                  <td className="r mono">{fmtPkr(round2(r.amountUsd * period.usdToPkr))}</td>
                  <td>
                    <label className="check">
                      <input type="checkbox" checked={r.settled} onChange={(e) => update((d) => {
                        const x = d.reimbursements.find((y) => y.id === r.id); if (x) x.settled = e.target.checked;
                      })} /> paid
                    </label>
                  </td>
                  <td><button className="btn ghost danger" onClick={() => update((d) => {
                    d.reimbursements = d.reimbursements.filter((y) => y.id !== r.id);
                  })}>×</button></td>
                </tr>
              ))}
              {!period.reimbursements.length && <tr><td className="empty">None.</td></tr>}
            </tbody>
          </table>
        </section>

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
                  <td><TextInput value={t.label} onChange={(v) => update((d) => {
                    const x = d.transfers.find((y) => y.id === t.id); if (x) x.label = v;
                  })} width={140} /></td>
                  <td><input className="cell-input" type="date" value={t.date} onChange={(e) => update((d) => {
                    const x = d.transfers.find((y) => y.id === t.id); if (x) x.date = e.target.value;
                  })} /></td>
                  <td><NumberInput value={t.amountPkr} onChange={(v) => update((d) => {
                    const x = d.transfers.find((y) => y.id === t.id); if (x) x.amountPkr = v;
                  })} width={110} suffix="PKR" /></td>
                  <td><button className="btn ghost danger" onClick={() => update((d) => {
                    d.transfers = d.transfers.filter((y) => y.id !== t.id);
                  })}>×</button></td>
                </tr>
              ))}
              {!period.transfers.length && <tr><td className="empty">Nothing sent yet.</td></tr>}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2>Settlement</h2>
          <dl className="kv">
            <div><dt>Staff pay</dt><dd>{fmtPkr(result.totals.staffPayPkr)}</dd></div>
            <div><dt>Company share</dt><dd>{fmtPkr(result.totals.companyPkr)}</dd></div>
            <div><dt>Reimbursements</dt><dd>{fmtPkr(L.reimbursementsPkr)}</dd></div>
            <div className="rule"><dt>Transferable</dt><dd>{fmtPkr(L.transferablePkr)}</dd></div>
            <div><dt>Already transferred</dt><dd>−{fmtPkr(L.transferredPkr)}</dd></div>
            <div className="total"><dt>Remaining to send</dt><dd>{fmtPkr(L.remainingPkr)}</dd></div>
          </dl>
        </section>
      </div>
    </div>
  );
}
