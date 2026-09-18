import type { Account, Period } from '../lib/types';
import { STATUS_OPTIONS } from '../lib/types';
import { fmtPkr, fmtUsd, type PeriodResult } from '../lib/calc';
import { hoursAsText } from '../lib/time';
import { EditOnly, EntriesInput, NumberInput, TextInput } from './Fields';
import { newAccount } from '../lib/state';
import { useCanEdit } from '../lib/access';

export default function AccountsTable({ result, update, timeFormat }: {
  result: PeriodResult;
  update: (fn: (p: Period) => void) => void;
  timeFormat: 'hm' | 'decimal';
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
          Money in <span className="hint">
            {timeFormat === 'hm'
              ? 'rate × time worked, less the platform fee — 12.20 means 12 hours 20 minutes'
              : 'rate × time worked, less the platform fee — 12.20 means 12.2 hours'}
          </span>
        </h2>
        <EditOnly>
          <button className="btn" onClick={() => update((d) => d.accounts.push(newAccount()))}>
            Add a client
          </button>
        </EditOnly>
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Looked after by</th>
              <th className="fig">Rate</th>
              <th>Time worked</th>
              <th className="fig">Total time</th>
              <th className="fig">Before fee</th>
              <th className="fig">Fee</th>
              <th className="fig">One-off +/−</th>
              <th className="fig">They pay us</th>
              <th className="fig">In PKR</th>
              <th className="fig">Team %</th>
              <th className="fig">Team gets</th>
              <th className="fig">Company gets</th>
              <th>Money in?</th>
              <th title="The client pays the company's account directly, so this money never reaches you">Straight to company</th>
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
                  <td className="fig mono">{hoursAsText(r.units)}</td>
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
                  <td className="mid">
                    <label className="check" title="The client pays the company's account directly">
                      <input type="checkbox" checked={a.paidDirect} disabled={!canEdit}
                        aria-label={`${a.name} is paid straight to the company`}
                        onChange={(e) => patch(a.id, { paidDirect: e.target.checked })} />
                    </label>
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
              <tr><td colSpan={16} className="empty">No clients yet — add one, or load a sheet.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>{result.accounts.length} clients</td>
              <td className="fig mono">{fmtUsd(t.grossUsd)}</td>
              <td className="fig mono">{fmtUsd(t.feeUsd)}</td>
              <td />
              <td className="fig mono total">{fmtUsd(t.earnedUsd)}</td>
              <td className="fig mono">{fmtPkr(t.earnedPkr)}</td>
              <td />
              <td className="fig mono">{fmtPkr(t.freelancerPkr)}</td>
              <td className="fig mono">{fmtPkr(t.companyPkr)}</td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
