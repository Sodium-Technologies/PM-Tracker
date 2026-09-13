import type { Period } from '../lib/types';
import { fmtPkr, round2, type PeriodResult } from '../lib/calc';
import { EditOnly, NumberInput, TextInput } from './Fields';
import { newStaff } from '../lib/state';

/** Shares are stored as fractions (0.35) and edited as percentages (35). */
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
      if (!d.staff.length) return;
      const share = Math.round((1 / d.staff.length) * 10000) / 10000;
      d.staff.forEach((s) => { s.shares[accountId] = share; });
    });

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          Division <span className="hint">each person's share of an account's team pool</span>
        </h2>
        <EditOnly>
          <button className="btn" onClick={() => update((d) => d.staff.push(newStaff()))}>
            Add team member
          </button>
        </EditOnly>
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Team member</th>
              <th className="fig">Pay</th>
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
                <td className="fig mono total">{fmtPkr(s.payPkr)}</td>
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
              <tr><td colSpan={result.accounts.length + 3} className="empty">No team members yet.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td>Allocated</td>
              <td className="fig mono">{fmtPkr(result.totals.staffPayPkr)}</td>
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
          {fmtPkr(result.totals.unallocatedPkr)} of the team pool is not assigned to anyone.
        </p>
      )}
    </section>
  );
}
