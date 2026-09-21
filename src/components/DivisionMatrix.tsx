import type { Period } from '../lib/types';
import { fmtPkr, fmtUsd, round2, sum, type PeriodResult } from '../lib/calc';
import { EditOnly, NumberInput, TextInput } from './Fields';
import { newStaff } from '../lib/state';
import { useCanEdit } from '../lib/access';
import { exportPayoutSheet } from '../lib/xlsx';

/** Shares are stored as fractions (0.35) and edited as percentages (35). */
export default function DivisionMatrix({ period, result, update, onApplyPaidHereEverywhere }: {
  period: Period;
  result: PeriodResult;
  update: (fn: (p: Period) => void) => void;
  onApplyPaidHereEverywhere: () => void;
}) {
  const canEdit = useCanEdit();
  const setShare = (staffId: string, accountId: string, pct: number) =>
    update((d) => {
      const s = d.staff.find((x) => x.id === staffId);
      if (!s) return;
      if (!pct) delete s.shares[accountId];
      else s.shares[accountId] = round2(pct) / 100;
    });

  const splitEvenly = (accountId: string) =>
    update((d) => {
      if (!d.staff.length) return;
      const share = Math.round((1 / d.staff.length) * 10000) / 10000;
      d.staff.forEach((s) => { s.shares[accountId] = share; });
    });

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          Payroll <span className="hint">what each person earns from each client, in %</span>
        </h2>
        <div className="head-actions">
          <EditOnly>
            {result.staff.some((s) => s.staff.retained) && (
              <button className="btn" title="Use these same marks in every month"
                onClick={onApplyPaidHereEverywhere}>Use in every month</button>
            )}
            <button className="btn" onClick={() => update((d) => d.staff.push(newStaff()))}>
              Add a person
            </button>
          </EditOnly>
          <button className="btn" onClick={() => exportPayoutSheet(period)}>Download this list</button>
        </div>
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th className="fig">Change by hand</th>
              <th className="fig">They get</th>
              <th className="fig" title="Money this person has already taken this month. It comes off their pay first; anything beyond it is a draw.">Taken already</th>
              <th className="fig">Still owed</th>
              <th title="You hand this person their pay yourself, so it does not need sending">You pay them</th>
              {result.accounts.map((a) => (
                <th key={a.account.id} className="fig">
                  <div>{a.account.name}</div>
                  <EditOnly>
                    <button className="link" onClick={() => splitEvenly(a.account.id)}>split evenly</button>
                  </EditOnly>
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {result.staff.map((s) => (
              <tr key={s.staff.id}>
                <td className="name">
                  <TextInput value={s.staff.name} onChange={(v) => update((d) => {
                    const m = d.staff.find((x) => x.id === s.staff.id); if (m) m.name = v;
                  })} />
                </td>
                <td className="fig">
                  <NumberInput value={s.staff.adjustmentPkr} width={78}
                    onChange={(v) => update((d) => {
                      const m = d.staff.find((x) => x.id === s.staff.id); if (m) m.adjustmentPkr = v;
                    })} />
                </td>
                <td className="fig mono total" title={fmtUsd(s.payUsd)}>{fmtPkr(s.payPkr)}</td>
                <td className="fig">
                  <NumberInput value={s.staff.advancePkr} width={78}
                    onChange={(v) => update((d) => {
                      const m = d.staff.find((x) => x.id === s.staff.id); if (m) m.advancePkr = v;
                    })} />
                </td>
                <td className={`fig mono${s.drawPkr > 0 ? ' alloc-off' : ' sub-fig'}`}
                  title={s.drawPkr > 0
                    ? `Took ${fmtPkr(s.staff.advancePkr)} against ${fmtPkr(s.payPkr)} of pay — ${fmtPkr(s.drawPkr)} is a draw`
                    : 'Pay not yet in their hands'}>
                  {s.drawPkr > 0 ? `draw ${fmtPkr(s.drawPkr)}` : fmtPkr(s.stillOwedPkr)}
                </td>
                <td className="mid">
                  <label className="check">
                    <input type="checkbox" checked={s.staff.retained} disabled={!canEdit}
                      aria-label={`You pay ${s.staff.name} yourself`}
                      onChange={(e) => update((d) => {
                        const m = d.staff.find((x) => x.id === s.staff.id); if (m) m.retained = e.target.checked;
                      })} />
                  </label>
                </td>
                {result.accounts.map((a) => {
                  const share = s.staff.shares[a.account.id] || 0;
                  return (
                    <td key={a.account.id} className={`share${share ? ' set' : ''}`}>
                      <NumberInput
                        value={round2(share * 100)}
                        onChange={(v) => setShare(s.staff.id, a.account.id, v)}
                        width={46}
                        unit="%"
                      />
                    </td>
                  );
                })}
                <td>
                  <EditOnly>
                    <button className="btn icon" title={`Remove ${s.staff.name}`} aria-label={`Remove ${s.staff.name}`}
                      onClick={() => update((d) => { d.staff = d.staff.filter((x) => x.id !== s.staff.id); })}>×</button>
                  </EditOnly>
                </td>
              </tr>
            ))}
            {!period.staff.length && (
              <tr><td colSpan={result.accounts.length + 7} className="empty">Nobody added yet.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td>Shared out</td>
              <td />
              <td className="fig mono">{fmtPkr(result.totals.staffPayPkr)}</td>
              <td className="fig mono">{fmtPkr(result.ledger.advancesPkr + result.ledger.drawsPkr)}</td>
              <td className="fig mono">{fmtPkr(sum(result.staff.map((s) => s.stillOwedPkr)))}</td>
              <td />
              {result.accounts.map((a) => {
                const pct = round2(a.allocated * 100);
                const ok = pct === 100 || a.earnedUsd === 0;
                return (
                  <td key={a.account.id} className={`fig mono ${ok ? 'alloc-ok' : 'alloc-off'}`}>
                    {pct}%
                  </td>
                );
              })}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {result.totals.unallocatedPkr !== 0 && (
        <p className="panel-note">
          {fmtPkr(result.totals.unallocatedPkr)} of the team's money has not been given to anyone.
        </p>
      )}
    </section>
  );
}
