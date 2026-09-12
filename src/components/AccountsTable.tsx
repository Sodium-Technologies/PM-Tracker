import type { Account, Period } from '../lib/types';
import { STATUS_OPTIONS } from '../lib/types';
import { fmtNum, fmtPkr, fmtUsd, type PeriodResult } from '../lib/calc';
import { EntriesInput, NumberInput, TextInput } from './Fields';
import { newAccount } from '../lib/state';

export default function AccountsTable({ period, result, update }: {
  period: Period;
  result: PeriodResult;
  update: (fn: (p: Period) => void) => void;
}) {
  const patch = (id: string, p: Partial<Account>) =>
    update((d) => {
      const a = d.accounts.find((x) => x.id === id);
      if (a) Object.assign(a, p);
    });

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Revenue by account</h2>
        <button className="btn" onClick={() => update((d) => d.accounts.push(newAccount()))}>
          + Add account
        </button>
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Owner</th>
              <th>Mode</th>
              <th>Rate</th>
              <th>Time entries</th>
              <th className="r">Units</th>
              <th className="r">Gross</th>
              <th>Fee %</th>
              <th>Adjust $</th>
              <th className="r">Earned</th>
              <th className="r">Earned PKR</th>
              <th>Split %</th>
              <th className="r">Freelancer PKR</th>
              <th className="r">Company PKR</th>
              <th>Status</th>
              <th>Notes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {result.accounts.map((r) => {
              const a = r.account;
              return (
                <tr key={a.id}>
                  <td><TextInput value={a.name} onChange={(v) => patch(a.id, { name: v })} width={160} /></td>
                  <td><TextInput value={a.owner} onChange={(v) => patch(a.id, { owner: v })} width={90} /></td>
                  <td>
                    <select className="cell-input" value={a.mode}
                      onChange={(e) => patch(a.id, { mode: e.target.value as Account['mode'] })}>
                      <option value="hourly">hourly</option>
                      <option value="fixed">fixed</option>
                    </select>
                  </td>
                  <td><NumberInput value={a.rate} onChange={(v) => patch(a.id, { rate: v })} width={70} /></td>
                  <td><EntriesInput entries={a.entries} onChange={(v) => patch(a.id, { entries: v })} /></td>
                  <td className="r mono">{fmtNum(r.units)}</td>
                  <td className="r mono">{fmtUsd(r.grossUsd)}</td>
                  <td><NumberInput value={a.feePct} onChange={(v) => patch(a.id, { feePct: v })} width={60} suffix="%" /></td>
                  <td><NumberInput value={a.adjustmentUsd} onChange={(v) => patch(a.id, { adjustmentUsd: v })} width={70} /></td>
                  <td className="r mono strong">{fmtUsd(r.earnedUsd)}</td>
                  <td className="r mono">{fmtPkr(r.earnedPkr)}</td>
                  <td><NumberInput value={a.freelancerPct} onChange={(v) => patch(a.id, { freelancerPct: v })} width={60} suffix="%" /></td>
                  <td className="r mono">{fmtPkr(r.freelancerPkr)}</td>
                  <td className="r mono">{fmtPkr(r.companyPkr)}</td>
                  <td>
                    <select className={`cell-input status s-${r.account.status.replace(/\s+/g, '-').toLowerCase()}`}
                      value={STATUS_OPTIONS.includes(a.status) ? a.status : 'Pending'}
                      onChange={(e) => patch(a.id, { status: e.target.value })}>
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td><TextInput value={a.notes} onChange={(v) => patch(a.id, { notes: v })} width={150} /></td>
                  <td>
                    <button className="btn ghost danger" title="Remove account"
                      onClick={() => update((d) => {
                        d.accounts = d.accounts.filter((x) => x.id !== a.id);
                        d.staff.forEach((s) => delete s.shares[a.id]);
                      })}>×</button>
                  </td>
                </tr>
              );
            })}
            {!result.accounts.length && (
              <tr><td colSpan={17} className="empty">No accounts yet — add one, or import a mastersheet.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6}>Totals</td>
              <td className="r mono">{fmtUsd(result.totals.grossUsd)}</td>
              <td className="r mono">{fmtUsd(result.totals.feeUsd)}</td>
              <td />
              <td className="r mono strong">{fmtUsd(result.totals.earnedUsd)}</td>
              <td className="r mono">{fmtPkr(result.totals.earnedPkr)}</td>
              <td />
              <td className="r mono">{fmtPkr(result.totals.freelancerPkr)}</td>
              <td className="r mono">{fmtPkr(result.totals.companyPkr)}</td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
