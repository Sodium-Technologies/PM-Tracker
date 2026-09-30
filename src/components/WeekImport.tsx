import React from 'react';
import type { Account, Period } from '../lib/types';
import { fmtUsd, round2, type PeriodResult } from '../lib/calc';
import { hoursAsText } from '../lib/time';
import {
  derive, findAccount, knownAliases, normalizeName, parseUpworkCsv, parseWeek, totalsByClient,
  type UpworkEntry, type WeekRow,
} from '../lib/week';
import { newAccount } from '../lib/state';

type Update = (fn: (p: Period) => void) => void;
type Action = 'append' | 'replace' | 'new' | 'skip';

interface Line {
  row: WeekRow;
  /** the client this lands on; '' when it is to become a new one */
  accountId: string;
  action: Action;
  matched: 'exact' | 'close' | 'remembered' | null;
}

const SAMPLE = 'Luxe\t20.5\t$205.00\t$20.50\nThree Bulls PM\t12\t$120.00\t$12.00';

/** A week off Upwork, reviewed before it touches anything.
 *
 *  Nothing here is applied until every line says where it goes and what it does,
 *  and the screen shows the month as it stands beside the week as it arrived —
 *  because a week applied to the wrong client, or applied twice, is not
 *  something the books will tell you about afterwards. */
export default function WeekImport({ period, periods, result, update, onClose }: {
  period: Period;
  /** every month, so a mapping made once is honoured everywhere */
  periods: Period[];
  result: PeriodResult;
  update: Update;
  onClose: () => void;
}) {
  const aliases = React.useMemo(() => knownAliases(periods), [periods]);
  const [text, setText] = React.useState('');
  const [lines, setLines] = React.useState<Line[] | null>(null);
  const [problems, setProblems] = React.useState<string[]>([]);
  /** the report, once one is loaded, and which of its weeks are wanted */
  const [entries, setEntries] = React.useState<UpworkEntry[] | null>(null);
  const [chosen, setChosen] = React.useState<Set<string>>(new Set());
  const [other, setOther] = React.useState({ usd: 0, count: 0 });
  const fileRef = React.useRef<HTMLInputElement>(null);

  const weeks = React.useMemo(() => {
    const seen = new Map<string, { week: string; paid: string; hours: number; earned: number; fee: number }>();
    for (const e of entries ?? []) {
      const at = seen.get(e.week) ?? { week: e.week, paid: e.paid, hours: 0, earned: 0, fee: 0 };
      at.hours += e.hours; at.earned += e.earningsUsd; at.fee += e.feeUsd;
      seen.set(e.week, at);
    }
    return [...seen.values()];
  }, [entries]);

  const onFile = async (file: File) => {
    const report = parseUpworkCsv(await file.text());
    setProblems(report.problems);
    setOther({ usd: report.otherUsd, count: report.otherCount });
    if (!report.entries.length) { setEntries(null); return; }
    setEntries(report.entries);
    setChosen(new Set(report.entries.map((e) => e.week)));
    setLines(null);
  };

  /** Turn the chosen weeks into one line per client, then review them exactly as
   *  a pasted block is reviewed. */
  const fromReport = () => {
    const rows = totalsByClient((entries ?? []).filter((e) => chosen.has(e.week)));
    setLines(rows.map((row) => {
      const hit = findAccount(row.name, period.accounts, aliases);
      return { row, accountId: hit?.id ?? '', action: (hit ? 'append' : 'skip') as Action, matched: hit?.how ?? null };
    }));
  };

  const read = () => {
    const { rows, problems: found } = parseWeek(text);
    setProblems(found);
    setLines(rows.map((row) => {
      const hit = findAccount(row.name, period.accounts, aliases);
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
        // Remember what this client is called on the other side, so the same
        // week never has to be mapped by hand twice.
        if (normalizeName(existing.name) !== normalizeName(row.name)
          && !(existing.aliases ?? []).some((x) => normalizeName(x) === normalizeName(row.name))) {
          existing.aliases = [...(existing.aliases ?? []), row.name];
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
        <h2>
          Add a week to {period.label}{' '}
          <span className="hint">nothing outside this month is touched</span>
        </h2>
        <button className="btn" onClick={onClose}>Close</button>
      </div>

      {!lines && !entries && (
        <div className="week-paste">
          <div className="week-drop">
            <b>Load the Upwork transaction report</b>
            <p className="settings-note">
              The CSV straight from Upwork — Reports → Transaction history → Download. Every
              week, rate and fee is read out of it; nothing has to be typed.
            </p>
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
            <button className="btn primary" onClick={() => fileRef.current?.click()}>Choose a CSV</button>
          </div>
          <details className="code-fallback">
            <summary>Or type the week in by hand</summary>
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
          </details>
        </div>
      )}

      {entries && !lines && (
        <>
          <p className="collect-lead">
            {entries.length} paid week{entries.length === 1 ? '' : 's'} across {weeks.length} payment
            {weeks.length === 1 ? '' : 's'}. Tick the ones that belong to {period.label}.
          </p>
          <table className="week-weeks">
            <thead>
              <tr>
                <th>Work week</th><th>Paid</th>
                <th className="fig">Hours</th><th className="fig">Earnings</th><th className="fig">Fee</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.week} className={chosen.has(w.week) ? undefined : 'week-skip'}>
                  <td>
                    <label className="check">
                      <input type="checkbox" checked={chosen.has(w.week)}
                        aria-label={`Include ${w.week}`}
                        onChange={(e) => setChosen((c) => {
                          const next = new Set(c);
                          if (e.target.checked) next.add(w.week); else next.delete(w.week);
                          return next;
                        })} />
                      {w.week}
                    </label>
                  </td>
                  <td className="muted small">{w.paid}</td>
                  <td className="fig mono">{hoursAsText(w.hours)}</td>
                  <td className="fig mono">{fmtUsd(w.earned)}</td>
                  <td className="fig mono sub-fig">{fmtUsd(w.fee)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>{chosen.size} of {weeks.length} chosen</td>
                <td className="fig mono">{hoursAsText(weeks.filter((w) => chosen.has(w.week)).reduce((t, w) => t + w.hours, 0))}</td>
                <td className="fig mono">{fmtUsd(weeks.filter((w) => chosen.has(w.week)).reduce((t, w) => t + w.earned, 0))}</td>
                <td className="fig mono sub-fig">{fmtUsd(weeks.filter((w) => chosen.has(w.week)).reduce((t, w) => t + w.fee, 0))}</td>
              </tr>
            </tfoot>
          </table>
          <div className="week-actions">
            <p className="settings-note">
              {other.count > 0 && `${other.count} withdrawal line${other.count === 1 ? '' : 's'} totalling ${fmtUsd(other.usd)} — money moved, not earned, so not counted here.`}
            </p>
            <button className="btn" onClick={() => { setEntries(null); setProblems([]); }}>Back</button>
            <button className="btn primary" onClick={fromReport} disabled={!chosen.size}>
              Match {chosen.size} week{chosen.size === 1 ? '' : 's'} to clients
            </button>
          </div>
        </>
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
                        {line.matched === 'remembered' && <span className="tag-inline">remembered</span>}
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
            <button className="btn" onClick={() => { setLines(null); if (!entries) setProblems([]); }}>Back</button>
            <button className="btn primary" onClick={apply} disabled={!willDo}>
              Apply to {period.label}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
