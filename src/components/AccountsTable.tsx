import type { Account, Period } from '../lib/types';
import { STATUS_OPTIONS } from '../lib/types';
import { fmtNum, fmtPkr, fmtUsd, type PeriodResult } from '../lib/calc';
import { EditOnly, EntriesInput, NumberInput, TextInput } from './Fields';
import { newAccount } from '../lib/state';
import { useCanEdit } from '../lib/access';

export default function AccountsTable({ result, update }: {
  result: PeriodResult;
  update: (fn: (p: Period) => void) => void;
}) {
  const canEdit = useCanEdit();
  const patch = (id: string, p: Partial<Account>) =>
    update((d) => {
      const a = d.accounts.find((x) => x.id === id);
      if (a) Object.assign(a, p);
    });

  const t = result.totals;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          Revenue by account <span className="hint">rate × time, less the fee deduction</span>
        </h2>
        <EditOnly>
          <button className="btn" onClick={() => update((d) => d.accounts.push(newAccount()))}>
            Add account
          </button>
        </EditOnly>
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Owner</th>
              <th className="fig">Rate</th>
              <th>Time entries</th>
              <th className="fig">Units</th>
              <th className="fig">Gross</th>
              <th className="fig">Fee</th>
              <th className="fig">Adjust</th>
              <th className="fig">Earned USD</th>
              <th className="fig">Earned PKR</th>
              <th className="fig">Split</th>
              <th className="fig">Team PKR</th>
              <th className="fig">Company PKR</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {result.accounts.map((r) => {
              const a = r.account;
              return (
                <tr key={a.id}>
                  <td className="name">
                    <TextInput value={a.name} onChange={(v) => patch(a.id, { name: v })} />
                    {a.notes && <span className="sub">{a.notes}</span>}
                  </td>
                  <td className="owner"><TextInput value={a.owner} onChange={(v) => patch(a.id, { owner: v })} /></td>
                  <td className="fig">
                    <span className="unit">
                      <NumberInput value={a.rate} onChange={(v) => patch(a.id, { rate: v })} width={64} />
                      <button
                        className="tag toggle"
                        title={`Billed in ${a.currency} — click to switch`}
                        onClick={() => patch(a.id, { currency: a.currency === 'USD' ? 'PKR' : 'USD' })}
                      >{a.currency === 'PKR' ? 'PKR' : 'USD'}</button>
                    </span>
                  </td>
                  <td><EntriesInput entries={a.entries} onChange={(v) => patch(a.id, { entries: v })} /></td>
                  <td className="fig mono">{fmtNum(r.units)}</td>
                  <td className="fig mono">{fmtUsd(r.grossUsd)}</td>
                  <td className="fig">
                    <NumberInput value={a.feePct} onChange={(v) => patch(a.id, { feePct: v })} width={48} unit="%" />
                  </td>
                  <td className="fig">
                    <NumberInput value={a.adjustmentUsd} onChange={(v) => patch(a.id, { adjustmentUsd: v })} width={64} />
                  </td>
                  <td className="fig mono total">{fmtUsd(r.earnedUsd)}</td>
                  <td className="fig mono">{fmtPkr(r.earnedPkr)}</td>
                  <td className="fig">
                    <NumberInput value={a.freelancerPct} onChange={(v) => patch(a.id, { freelancerPct: v })} width={48} unit="%" />
                  </td>
                  <td className="fig mono">{fmtPkr(r.freelancerPkr)}</td>
                  <td className="fig mono">{fmtPkr(r.companyPkr)}</td>
                  <td>
                    <select
                      disabled={!canEdit}
                      className={`pill s-${a.status.replace(/\s+/g, '-').toLowerCase()}`}
                      value={STATUS_OPTIONS.includes(a.status) ? a.status : 'Pending'}
                      onChange={(e) => patch(a.id, { status: e.target.value })}
                    >
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td>
                    <EditOnly>
                    <button className="btn icon" title={`Remove ${a.name}`} aria-label={`Remove ${a.name}`}
                      onClick={() => update((d) => {
                        d.accounts = d.accounts.filter((x) => x.id !== a.id);
                        d.staff.forEach((s) => delete s.shares[a.id]);
                      })}>×</button>
                    </EditOnly>
                  </td>
                </tr>
              );
            })}
            {!result.accounts.length && (
              <tr><td colSpan={15} className="empty">No accounts yet — add one, or import a mastersheet.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>{result.accounts.length} accounts</td>
              <td className="fig mono">{fmtUsd(t.grossUsd)}</td>
              <td className="fig mono">{fmtUsd(t.feeUsd)}</td>
              <td />
              <td className="fig mono total">{fmtUsd(t.earnedUsd)}</td>
              <td className="fig mono">{fmtPkr(t.earnedPkr)}</td>
              <td />
              <td className="fig mono">{fmtPkr(t.freelancerPkr)}</td>
              <td className="fig mono">{fmtPkr(t.companyPkr)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
