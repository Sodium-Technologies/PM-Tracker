import React from 'react';
import type { Account, Period } from '../lib/types';
import { fmtPkr, fmtUsd, round2, type PeriodResult } from '../lib/calc';
import { hoursAsText } from '../lib/time';
import { EditOnly, EntriesInput, NumberInput, OptionalNumberInput, TextInput } from './Fields';
import { newAccount } from '../lib/state';
import { useCanEdit } from '../lib/access';
import WeekImport from './WeekImport';

export default function AccountsTable({ period, periods, result, update, timeFormat }: {
  period: Period;
  periods: Period[];
  result: PeriodResult;
  update: (fn: (p: Period) => void) => void;
  timeFormat: 'hm' | 'decimal';
}) {
  const [week, setWeek] = React.useState(false);
  const canEdit = useCanEdit();
  const patch = (id: string, p: Partial<Account>) =>
    update((d) => {
      const a = d.accounts.find((x) => x.id === id);
      if (a) Object.assign(a, p);
    });

  const t = result.totals;

  if (week) {
    return (
      <WeekImport period={period} periods={periods} result={result} update={update}
        onClose={() => setWeek(false)} />
    );
  }

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
        <div className="head-actions">
          <EditOnly>
            <button className="btn" onClick={() => setWeek(true)}>Add a week</button>
            <button className="btn" onClick={() => update((d) => d.accounts.push(newAccount()))}>
              Add a client
            </button>
          </EditOnly>
        </div>
      </div>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th className="fig">Rate</th>
              <th>Time worked</th>
              <th className="fig">Total time</th>
              <th className="fig">Before fee</th>
              <th className="fig">Fee</th>
              <th className="fig" title="A correction after the fee — a refund, a bonus, a true-up">Adjustment</th>
              <th className="fig" title="What the work is worth, whether or not it has been paid">Estimated</th>
              <th className="fig" title="What the client has actually sent. Left blank it follows the status: the full estimate once marked received, nothing before that. Type a figure for a part payment.">Received</th>
              <th className="fig" title="Estimated, less received">Outstanding</th>
              <th className="fig">In PKR</th>
              <th className="fig">Team gets</th>
              <th className="fig">Company gets</th>
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
                  {/* the box is in the account's own currency, so the hint is too */}
                  <td className="fig">
                    <OptionalNumberInput
                      value={a.receivedAmount}
                      label={`Received from ${a.name}`}
                      placeholder={round2(a.currency === 'PKR' ? r.receivedPkr : r.receivedUsd).toString()}
                      onChange={(v) => patch(a.id, { receivedAmount: v })}
                    />
                    {r.receivedIsManual && (
                      <EditOnly>
                        <button className="link tiny" title="Go back to following the status"
                          onClick={() => patch(a.id, { receivedAmount: null })}>auto</button>
                      </EditOnly>
                    )}
                  </td>
                  <td className={`fig mono${r.outstandingUsd > 0.005 ? ' alloc-off' : ' sub-fig'}`}>
                    {r.outstandingUsd > 0.005 ? fmtUsd(r.outstandingUsd) : '—'}
                  </td>
                  <td className="fig mono">{fmtPkr(r.earnedPkr)}</td>
                  <td className="fig mono">{fmtPkr(r.freelancerPkr)}</td>
                  <td className="fig mono">{fmtPkr(r.companyPkr)}</td>
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
              <tr><td colSpan={14} className="empty">No clients yet — add one, or load a sheet.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>{result.accounts.length} clients</td>
              <td className="fig mono">{fmtUsd(t.grossUsd)}</td>
              <td className="fig mono">{fmtUsd(t.feeUsd)}</td>
              <td />
              <td className="fig mono total">{fmtUsd(t.earnedUsd)}</td>
              <td className="fig mono total">{fmtUsd(t.receivedUsd)}</td>
              <td className={`fig mono${t.outstandingUsd > 0.005 ? ' alloc-off' : ''}`}>
                {t.outstandingUsd > 0.005 ? fmtUsd(t.outstandingUsd) : '—'}
              </td>
              <td className="fig mono">{fmtPkr(t.earnedPkr)}</td>
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
