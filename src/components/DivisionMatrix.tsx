import type { Period } from '../lib/types';
import { fmtPkr, round2, type PeriodResult } from '../lib/calc';
import { NumberInput, TextInput } from './Fields';
import { newStaff } from '../lib/state';

/** Shares are stored as fractions (0.35) but edited as percentages (35%). */
export default function DivisionMatrix({ period, result, update }: {
  period: Period;
  result: PeriodResult;
  update: (fn: (p: Period) => void) => void;
}) {
  const setShare = (staffId: string, accountId: string, pct: number) =>
    update((d) => {
      const s = d.staff.find((x) => x.id === staffId);
      if (!s) return;
      if (!pct) delete s.shares[accountId];
      else s.shares[accountId] = round2(pct) / 100;
    });

  const splitEvenly = (accountId: string) =>
    update((d) => {
      const share = d.staff.length ? 1 / d.staff.length : 0;
      d.staff.forEach((s) => { s.shares[accountId] = round2(share * 10000) / 10000; });
    });

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Division — who earns what share of each account</h2>
        <button className="btn" onClick={() => update((d) => d.staff.push(newStaff()))}>+ Add team member</button>
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Team member</th>
              <th className="r">Pay (PKR)</th>
              {result.accounts.map((a) => (
                <th key={a.account.id} className="rot">
                  <div>{a.account.name}</div>
                  <button className="link" onClick={() => splitEvenly(a.account.id)}>split evenly</button>
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {result.staff.map((s) => (
              <tr key={s.staff.id}>
                <td><TextInput value={s.staff.name} onChange={(v) => update((d) => {
                  const m = d.staff.find((x) => x.id === s.staff.id); if (m) m.name = v;
                })} width={150} /></td>
                <td className="r mono strong">{fmtPkr(s.payPkr)}</td>
                {result.accounts.map((a) => (
                  <td key={a.account.id} className={s.staff.shares[a.account.id] ? 'has-share' : ''}>
                    <NumberInput
                      value={round2((s.staff.shares[a.account.id] || 0) * 100)}
                      onChange={(v) => setShare(s.staff.id, a.account.id, v)}
                      width={62}
                      suffix="%"
                    />
                  </td>
                ))}
                <td>
                  <button className="btn ghost danger" title="Remove member"
                    onClick={() => update((d) => { d.staff = d.staff.filter((x) => x.id !== s.staff.id); })}>×</button>
                </td>
              </tr>
            ))}
            {!period.staff.length && (
              <tr><td colSpan={result.accounts.length + 3} className="empty">No team members yet.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td>Allocated</td>
              <td className="r mono">{fmtPkr(result.totals.staffPayPkr)}</td>
              {result.accounts.map((a) => {
                const pct = round2(a.allocated * 100);
                const ok = pct === 100 || a.earnedUsd === 0;
                return <td key={a.account.id} className={`r mono ${ok ? 'ok' : 'warn'}`}>{pct}%</td>;
              })}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {result.totals.unallocatedPkr !== 0 && (
        <p className="note warn-text">
          {fmtPkr(result.totals.unallocatedPkr)} of the freelancer pool is not assigned to anyone.
        </p>
      )}
    </section>
  );
}
