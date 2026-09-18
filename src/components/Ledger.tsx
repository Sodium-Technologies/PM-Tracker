import type { LineItem, Period } from '../lib/types';
import { fmtPkr, round2, type PeriodResult } from '../lib/calc';
import { EditOnly, NumberInput, TextInput } from './Fields';
import { useCanEdit } from '../lib/access';
import { uid } from '../lib/state';

type Update = (fn: (p: Period) => void) => void;

export default function Ledger({ period, result, update }: {
  period: Period; result: PeriodResult; update: Update;
}) {
  const canEdit = useCanEdit();
  const L = result.ledger;

  return (
    <div className="cols">
      <div className="stack">
        <section className="panel wages">
          <div className="panel-head">
            <h2>You paid this yourself <span className="hint">so it does not need sending</span></h2>
            <EditOnly>
              <button className="btn" onClick={() => update((d) => d.localWages.push({
                id: uid(), label: 'Draw', amountPkr: 0,
              }))}>Add</button>
            </EditOnly>
          </div>
          <table>
            <tbody>
              {result.staff.filter((s) => s.staff.retained).map((s) => (
                <tr key={s.staff.id}>
                  <td>{s.staff.name} <span className="tag-inline">pay</span></td>
                  <td className="fig mono">{fmtPkr(s.payPkr)}</td>
                  <td className="muted small">their share of the work</td>
                  <td />
                </tr>
              ))}
              {period.localWages.map((w) => (
                <tr key={w.id}>
                  <td><TextInput value={w.label}
                    onChange={(v) => update((d) => { const x = d.localWages.find((y) => y.id === w.id); if (x) x.label = v; })} /></td>
                  <td className="fig">
                    <NumberInput value={w.amountPkr} width={96} unit="PKR"
                      onChange={(v) => update((d) => { const x = d.localWages.find((y) => y.id === w.id); if (x) x.amountPkr = v; })} />
                  </td>
                  <td className="muted small">taken by you</td>
                  <td>
                    <EditOnly>
                      <button className="btn icon" aria-label={`Remove ${w.label}`} onClick={() => update((d) => {
                        d.localWages = d.localWages.filter((y) => y.id !== w.id);
                      })}>×</button>
                    </EditOnly>
                  </td>
                </tr>
              ))}
              {!L.localWagesPkr && !period.localWages.length && (
                <tr><td colSpan={4} className="empty">You have not paid anyone yourself this month.</td></tr>
              )}
            </tbody>
            {L.localWagesPkr > 0 && (
              <tfoot>
                <tr>
                  <td>Total you paid</td>
                  <td className="fig mono total">{fmtPkr(L.localWagesPkr)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </section>

        <section className="panel">
          <div className="panel-head"><h2>What is left to send</h2><span className="hint">all figures in PKR</span></div>
          <dl className="settle">
            <div className="row"><dt>Pay for the team</dt><dd>{fmtPkr(result.totals.staffPayPkr)}</dd></div>
            <div className="row"><dt>Other people to pay</dt><dd>{fmtPkr(L.otherPayablesPkr)}</dd></div>
            <div className="row"><dt>The company's share</dt><dd>{fmtPkr(result.totals.companyPkr)}</dd></div>
            <div className="row rule"><dt>Total to pay out</dt><dd>{fmtPkr(L.transferablePkr)}</dd></div>
            <div className="row"><dt>Went straight to the company</dt><dd>−{fmtPkr(L.directPkr)}</dd></div>
            <div className="row"><dt>Already spent on that side</dt><dd>−{fmtPkr(L.reimbursementsPkr)}</dd></div>
            <div className="row"><dt>You paid it yourself</dt><dd>−{fmtPkr(L.localWagesPkr)}</dd></div>
            <div className="row"><dt>Kept back this month</dt><dd>−{fmtPkr(L.withheldPkr)}</dd></div>
            <div className="row"><dt>Already sent</dt><dd>−{fmtPkr(L.transfersPkr)}</dd></div>
            <div className={`row final${L.remainingPkr < 0 ? ' negative' : ''}`}>
              <dt>Left to send</dt><dd>{fmtPkr(L.remainingPkr)}</dd>
            </div>
          </dl>
        </section>

      </div>

      <div className="stack">
        <LineItems
          title="Money already spent there"
          hint="in USD — subscriptions, advances"
          rows={period.reimbursements.map((r) => ({ id: r.id, label: r.label, amountPkr: round2(r.amountUsd * period.usdToPkr) }))}
          usd={period.reimbursements}
          period={period}
          onAdd={() => update((d) => d.reimbursements.push({ id: uid(), label: 'Expense', amountUsd: 0 }))}
          onLabel={(id, v) => update((d) => { const x = d.reimbursements.find((y) => y.id === id); if (x) x.label = v; })}
          onAmount={(id, v) => update((d) => { const x = d.reimbursements.find((y) => y.id === id); if (x) x.amountUsd = v; })}
          onRemove={(id) => update((d) => { d.reimbursements = d.reimbursements.filter((y) => y.id !== id); })}
        />

        <LineItems
          title="Other people to pay"
          hint="anyone with no share of a client"
          rows={period.otherPayables}
          period={period}
          onAdd={() => update((d) => d.otherPayables.push({ id: uid(), label: 'Name', amountPkr: 0 }))}
          onLabel={(id, v) => update((d) => { const x = d.otherPayables.find((y) => y.id === id); if (x) x.label = v; })}
          onAmount={(id, v) => update((d) => { const x = d.otherPayables.find((y) => y.id === id); if (x) x.amountPkr = v; })}
          onRemove={(id) => update((d) => { d.otherPayables = d.otherPayables.filter((y) => y.id !== id); })}
        />

        <LineItems
          title="Kept back this month"
          hint="not sent, not spent"
          rows={period.withheld}
          period={period}
          onAdd={() => update((d) => d.withheld.push({ id: uid(), label: 'NA kept', amountPkr: 0 }))}
          onLabel={(id, v) => update((d) => { const x = d.withheld.find((y) => y.id === id); if (x) x.label = v; })}
          onAmount={(id, v) => update((d) => { const x = d.withheld.find((y) => y.id === id); if (x) x.amountPkr = v; })}
          onRemove={(id) => update((d) => { d.withheld = d.withheld.filter((y) => y.id !== id); })}
        />

        <section className="panel">
          <div className="panel-head">
            <h2>Money already sent</h2>
            <EditOnly>
              <button className="btn" onClick={() => update((d) => d.transfers.push({
                id: uid(), label: 'Transfer', amountPkr: 0, date: new Date().toISOString().slice(0, 10),
              }))}>Add</button>
            </EditOnly>
          </div>
          <table>
            <tbody>
              {period.transfers.map((t) => (
                <tr key={t.id}>
                  <td><TextInput value={t.label}
                    onChange={(v) => update((d) => { const x = d.transfers.find((y) => y.id === t.id); if (x) x.label = v; })} /></td>
                  <td>
                    <input className="cell-input" type="date" value={t.date} aria-label="Transfer date" readOnly={!canEdit}
                      onChange={(e) => update((d) => { const x = d.transfers.find((y) => y.id === t.id); if (x) x.date = e.target.value; })} />
                  </td>
                  <td className="fig">
                    <NumberInput value={t.amountPkr} width={96} unit="PKR"
                      onChange={(v) => update((d) => { const x = d.transfers.find((y) => y.id === t.id); if (x) x.amountPkr = v; })} />
                  </td>
                  <td>
                    <EditOnly>
                      <button className="btn icon" aria-label={`Remove ${t.label}`} onClick={() => update((d) => {
                        d.transfers = d.transfers.filter((y) => y.id !== t.id);
                      })}>×</button>
                    </EditOnly>
                  </td>
                </tr>
              ))}
              {!period.transfers.length && <tr><td className="empty">Nothing sent yet this month.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function LineItems({ title, hint, rows, usd, period, onAdd, onLabel, onAmount, onRemove }: {
  title: string;
  hint?: string;
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
        <h2>{title} {hint && <span className="hint">{hint}</span>}</h2>
        <EditOnly><button className="btn" onClick={onAdd}>Add</button></EditOnly>
      </div>
      <table>
        <tbody>
          {rows.map((r) => {
            const u = usd?.find((x) => x.id === r.id);
            return (
              <tr key={r.id}>
                <td><TextInput value={r.label} onChange={(v) => onLabel(r.id, v)} /></td>
                <td className="fig">
                  {u
                    ? <NumberInput value={u.amountUsd} onChange={(v) => onAmount(r.id, v)} width={68} unit="USD" />
                    : <NumberInput value={r.amountPkr} onChange={(v) => onAmount(r.id, v)} width={96} unit="PKR" />}
                </td>
                <td className="fig mono sub">{u ? fmtPkr(round2(u.amountUsd * period.usdToPkr)) : ''}</td>
                <td>
                  <EditOnly>
                    <button className="btn icon" aria-label={`Remove ${r.label}`} onClick={() => onRemove(r.id)}>×</button>
                  </EditOnly>
                </td>
              </tr>
            );
          })}
          {!rows.length && <tr><td className="empty">None.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
