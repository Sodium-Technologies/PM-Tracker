import React from 'react';
import type { Account, Period } from '../lib/types';
import { fmtUsd, round2, type PeriodResult } from '../lib/calc';
import { hoursAsText } from '../lib/time';
import { derive, findAccount, parseWeek, type WeekRow } from '../lib/week';
import { newAccount } from '../lib/state';

type Update = (fn: (p: Period) => void) => void;
type Action = 'append' | 'replace' | 'new' | 'skip';

interface Line {
  row: WeekRow;
  /** the client this lands on; '' when it is to become a new one */
  accountId: string;
  action: Action;
  matched: 'exact' | 'close' | null;
}

const SAMPLE = 'Luxe\t20.5\t$205.00\t$20.50\nThree Bulls PM\t12\t$120.00\t$12.00';

/** A week off Upwork, reviewed before it touches anything.
 *
 *  Nothing here is applied until every line says where it goes and what it does,
 *  and the screen shows the month as it stands beside the week as it arrived —
 *  because a week applied to the wrong client, or applied twice, is not
 *  something the books will tell you about afterwards. */
export default function WeekImport({ period, result, update, onClose }: {
  period: Period;
  result: PeriodResult;
  update: Update;
  onClose: () => void;
}) {
  const [text, setText] = React.useState('');
  const [lines, setLines] = React.useState<Line[] | null>(null);
  const [problems, setProblems] = React.useState<string[]>([]);

  const read = () => {
    const { rows, problems: found } = parseWeek(text);
    setProblems(found);
    setLines(rows.map((row) => {
      const hit = findAccount(row.name, period.accounts);
      return {
        row,
        accountId: hit?.id ?? '',
        // An unmatched line defaults to nothing: adding a client nobody asked
        // for is as wrong as putting the hours on the wrong one.
        action: hit ? 'append' : 'skip',
        matched: hit?.how ?? null,
      };
    }));
  };

  const set = (i: number, patch: Partial<Line>) =>
    setLines((ls) => (ls ? ls.map((l, j) => (j === i ? { ...l, ...patch } : l)) : ls));

  const apply = () => {
    const doing = (lines ?? []).filter((l) => l.action !== 'skip');
    if (!doing.length) return;
    update((d) => {
      for (const line of doing) {
        const { row } = line;
        const existing = d.accounts.find((a) => a.id === line.accountId);
        const rateFromMoney = derive(row, existing?.rate ?? 0).rate;
        const feeFromMoney = derive(row, existing?.rate ?? 0).feePct;

        if (line.action === 'new' || !existing) {
          d.accounts.push(newAccount({
            name: row.name,
            currency: 'USD',
            rate: rateFromMoney !== null ? round2(rateFromMoney) : 0,
            feePct: feeFromMoney !== null ? round2(feeFromMoney) : 0,
            entries: [row.hours],
          }));
          continue;
        }
        if (rateFromMoney !== null) existing.rate = round2(rateFromMoney);
        if (feeFromMoney !== null) existing.feePct = round2(feeFromMoney);
        if (line.action === 'replace') existing.entries = [row.hours];
        else {
          // An untouched client carries a single zero as scaffolding, not as a
          // week that was worked; the first real week takes its place.
          const kept = existing.entries.filter((e) => Number(e) !== 0);
          existing.entries = [...kept, row.hours];
        }
      }
    });
    onClose();
  };

  const willDo = (lines ?? []).filter((l) => l.action !== 'skip').length;
  const unplaced = (lines ?? []).filter((l) => l.action === 'skip' && !l.accountId).length;

  return (
    <section className="panel span-2 week">
      <div className="panel-head">
        <h2>Add a week <span className="hint">from an Upwork timesheet and its transactions</span></h2>
        <button className="btn" onClick={onClose}>Close</button>
      </div>

      {!lines && (
        <div className="week-paste">
          <label htmlFor="week-text">
            One line per project: <b>name, hours, earnings, fee</b> — tabs or commas.
          </label>
          <textarea
            id="week-text"
            rows={7}
            spellCheck={false}
            placeholder={SAMPLE}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="week-actions">
            <button className="btn primary" onClick={read} disabled={!text.trim()}>Read the week</button>
          </div>
        </div>
      )}

      {problems.length > 0 && (
        <ul className="notices">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
      )}

      {lines && (
        <>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>From the timesheet</th>
                  <th className="fig">Hours</th>
                  <th className="fig">Earnings</th>
                  <th className="fig">Fee</th>
                  <th className="fig">Rate it implies</th>
                  <th>Goes to</th>
                  <th className="fig">Has now</th>
                  <th>What to do</th>
                  <th className="fig">Will have</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => {
                  const account = result.accounts.find((a) => a.account.id === line.accountId);
                  const d = derive(line.row, account?.account.rate ?? 0);
                  const now = account?.units ?? 0;
                  const after = line.action === 'skip' ? now
                    : line.action === 'replace' ? line.row.hours
                      : line.action === 'new' ? line.row.hours
                        : now + line.row.hours;
                  return (
                    <tr key={i} className={line.action === 'skip' ? 'week-skip' : undefined}>
                      <td>
                        {line.row.name}
                        {line.matched === 'close' && <span className="tag-inline">close match</span>}
                        {d.disagrees && (
                          <span className="sub warn-text">
                            the money says {hoursAsText(d.hoursFromMoney ?? 0)}, the timesheet says {hoursAsText(line.row.hours)}
                          </span>
                        )}
                      </td>
                      <td className="fig mono">{hoursAsText(line.row.hours)}</td>
                      <td className="fig mono">{fmtUsd(line.row.earningsUsd)}</td>
                      <td className="fig mono">{fmtUsd(line.row.feeUsd)}</td>
                      <td className="fig mono sub-fig">
                        {d.rate === null ? '—' : `${fmtUsd(d.rate)}/h`}
                        {d.feePct !== null && <span className="sub">{round2(d.feePct)}% fee</span>}
                      </td>
                      <td>
                        <select
                          className="cell-input"
                          aria-label={`Where ${line.row.name} goes`}
                          value={line.action === 'new' ? '__new' : line.accountId}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === '__new') set(i, { accountId: '', action: 'new' });
                            else if (!v) set(i, { accountId: '', action: 'skip' });
                            else set(i, { accountId: v, action: line.action === 'skip' || line.action === 'new' ? 'append' : line.action });
                          }}
                        >
                          <option value="">Leave it out</option>
                          <option value="__new">Add as a new client</option>
                          {period.accounts.map((a: Account) => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="fig mono sub-fig">{account ? hoursAsText(now) : '—'}</td>
                      <td>
                        {line.action === 'new'
                          ? <span className="tag-inline">new client</span>
                          : (
                            <select
                              className="cell-input"
                              aria-label={`What to do with ${line.row.name}`}
                              disabled={!line.accountId}
                              value={line.action}
                              onChange={(e) => set(i, { action: e.target.value as Action })}
                            >
                              <option value="append">Add to the month</option>
                              <option value="replace">Replace the month</option>
                              <option value="skip">Leave it out</option>
                            </select>
                          )}
                      </td>
                      <td className={`fig mono${after !== now ? ' total' : ' sub-fig'}`}>
                        {hoursAsText(after)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="week-actions">
            <p className="settings-note">
              {willDo} of {lines.length} line{lines.length === 1 ? '' : 's'} will be applied
              {unplaced > 0 && ` · ${unplaced} not matched to a client yet`}
              {' · '}rate and fee are taken from the transactions.
            </p>
            <button className="btn" onClick={() => { setLines(null); setProblems([]); }}>Back</button>
            <button className="btn primary" onClick={apply} disabled={!willDo}>
              Apply to {period.label}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
