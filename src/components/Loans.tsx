import React from 'react';
import type { Currency } from '../lib/types';
import { fmtPkr, fmtUsd } from '../lib/calc';
import {
  byPerson, computeLoan, exportLoans, loanTotals, newLoan, newRepayment, SETUP_NOTE, today, useLoans,
  type Loan, type LoanResult,
} from '../lib/loans';
import { DateInput, NumberInput, TextInput } from './Fields';

const money = (n: number, c: Currency) => (c === 'USD' ? fmtUsd(n) : fmtPkr(n));
/** Both currencies, leaving out whichever is nothing. */
const both = (r: Record<Currency, number>) => {
  const parts = (['PKR', 'USD'] as Currency[]).filter((c) => Math.abs(r[c]) >= 0.005).map((c) => money(r[c], c));
  return parts.length ? parts.join(' · ') : money(0, 'PKR');
};

/** A private ledger of money lent and borrowed, and what has come back. It
 *  belongs to no month. Only the person who records a loan can see it — the
 *  database holds back everyone else's. */
export default function Loans({ people }: { people: string[] }) {
  const ledger = useLoans();
  const [draft, setDraft] = React.useState<Loan>(() => newLoan());
  const [show, setShow] = React.useState<'open' | 'all'>('open');
  const [opened, setOpened] = React.useState<string | null>(null);

  const results = ledger.loans.map(computeLoan)
    .sort((a, b) => b.loan.date.localeCompare(a.loan.date) || a.loan.who.localeCompare(b.loan.who));
  const shown = show === 'open' ? results.filter((r) => r.status !== 'repaid') : results;
  const totals = loanTotals(ledger.loans);
  const people_ = byPerson(ledger.loans);

  const record = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.who.trim() || !(draft.amount > 0)) return;
    ledger.add({ ...draft, who: draft.who.trim() });
    setDraft(newLoan({ direction: draft.direction, currency: draft.currency }));
  };

  if (ledger.loading) return <p className="hint">Loading…</p>;

  return (
    <div className="loans">
      {ledger.missing && <p className="notices">{SETUP_NOTE}</p>}
      {ledger.error && <p className="notices">Not saved: {ledger.error}</p>}

      <dl className="figures">
        <Fig label="Owed to you" value={both(totals.owedToYou)} sub="still to come back" lead />
        <Fig label="You owe" value={both(totals.youOwe)} sub="still to pay back" />
        <Fig label="Repaid so far" value={both(totals.repaid)} sub="across every loan" />
        <Fig label="Open loans" value={String(totals.open)} sub={`of ${ledger.loans.length} recorded`} />
      </dl>

      <section className="panel">
        <div className="panel-head"><h2>Record a loan</h2></div>
        <form className="loan-form" onSubmit={record}>
          <label>
            <span>Date</span>
            <DateInput value={draft.date} label="Loan date" onChange={(v) => setDraft({ ...draft, date: v })} />
          </label>
          <label className="grow">
            <span>Who</span>
            <input id="loan-who" className="cell-input bordered" list="loan-people" value={draft.who}
              placeholder="a person or a company" onChange={(e) => setDraft({ ...draft, who: e.target.value })} />
            <datalist id="loan-people">{people.map((p) => <option key={p} value={p} />)}</datalist>
          </label>
          <label>
            <span>Which way</span>
            <select id="loan-direction" className="cell-input bordered" value={draft.direction}
              onChange={(e) => setDraft({ ...draft, direction: e.target.value as Loan['direction'] })}>
              <option value="lent">I lent it — they owe me</option>
              <option value="borrowed">I borrowed it — I owe them</option>
            </select>
          </label>
          <label>
            <span>Amount</span>
            <span className="unit">
              <input id="loan-amount" className="cell-input bordered num" type="number" step="any" min="0"
                value={draft.amount || ''} placeholder="0"
                onChange={(e) => setDraft({ ...draft, amount: parseFloat(e.target.value) || 0 })} />
              <select className="cell-input bordered" aria-label="Currency" value={draft.currency}
                onChange={(e) => setDraft({ ...draft, currency: e.target.value as Currency })}>
                <option value="PKR">PKR</option>
                <option value="USD">USD</option>
              </select>
            </span>
          </label>
          <label className="grow">
            <span>Note</span>
            <input className="cell-input bordered" value={draft.note} placeholder="optional"
              aria-label="Loan note" onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          </label>
          <button className="btn primary" type="submit" disabled={!draft.who.trim() || !(draft.amount > 0)}>
            Record loan
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Loans <span className="hint">newest first · click a loan to see and record repayments</span></h2>
          <div className="head-actions">
            <button className={`btn${show === 'open' ? ' primary' : ''}`} onClick={() => setShow('open')}>
              Open ({results.filter((r) => r.status !== 'repaid').length})
            </button>
            <button className={`btn${show === 'all' ? ' primary' : ''}`} onClick={() => setShow('all')}>
              All ({results.length})
            </button>
            <button className="btn" onClick={() => void exportLoans(ledger.loans)} disabled={!results.length}>
              Download as Excel
            </button>
          </div>
        </div>
        <div className="scroll">
          <table className="loan-table">
            <thead>
              <tr>
                <th>Who</th>
                <th>Date</th>
                <th>Which way</th>
                <th className="fig">Amount</th>
                <th className="fig">Repaid</th>
                <th className="fig">Balance</th>
                <th>Status</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <LoanRow key={r.loan.id} r={r} open={opened === r.loan.id}
                  onToggle={() => setOpened(opened === r.loan.id ? null : r.loan.id)}
                  update={(fn) => ledger.update(r.loan.id, fn)}
                  remove={() => {
                    if (!confirm(`Delete the loan ${r.loan.direction === 'lent' ? 'to' : 'from'} ${r.loan.who} of ${money(r.loan.amount, r.loan.currency)}, and its repayments?`)) return;
                    void ledger.remove(r.loan.id);
                  }} />
              ))}
              {!shown.length && (
                <tr><td colSpan={9} className="empty">
                  {results.length ? 'Every loan is repaid. Choose All to see them.' : 'No loans recorded yet.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {people_.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>Where each person stands <span className="hint">what is still open</span></h2></div>
          <div className="scroll">
            <table>
              <thead><tr><th>Who</th><th className="fig">PKR</th><th className="fig">USD</th><th>Means</th></tr></thead>
              <tbody>
                {people_.map((p) => {
                  const net = Math.abs(p.net.PKR) >= 0.005 ? p.net.PKR : p.net.USD;
                  return (
                    <tr key={p.who}>
                      <td>{p.who}</td>
                      <td className="fig mono">{Math.abs(p.net.PKR) >= 0.005 ? fmtPkr(p.net.PKR) : '—'}</td>
                      <td className="fig mono">{Math.abs(p.net.USD) >= 0.005 ? fmtUsd(p.net.USD) : '—'}</td>
                      <td className="hint">{net > 0 ? 'they owe you' : 'you owe them'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function LoanRow({ r, open, onToggle, update, remove }: {
  r: LoanResult; open: boolean; onToggle: () => void;
  update: (fn: (l: Loan) => void) => void; remove: () => void;
}) {
  const { loan } = r;
  const [pay, setPay] = React.useState({ date: today(), amount: 0, note: '' });
  const status = r.status === 'repaid' ? 'Repaid'
    : r.status === 'overpaid' ? `Overpaid by ${money(-r.balance, loan.currency)}` : 'Open';
  const addRepayment = (amount: number) => {
    if (!(amount > 0)) return;
    update((l) => { l.repayments.push(newRepayment({ date: pay.date || today(), amount, note: pay.note.trim() })); });
    setPay({ date: today(), amount: 0, note: '' });
  };
  return (
    <>
      <tr className={`loan-row${r.status === 'repaid' ? ' loan-done' : ''}${open ? ' loan-expanded' : ''}`}>
        <td className="name">
          <button className="link loan-toggle" aria-expanded={open} onClick={onToggle}
            title={open ? 'Hide repayments' : 'Show and record repayments'}>{open ? '▾' : '▸'}</button>
          <TextInput value={loan.who} onChange={(v) => update((l) => { l.who = v; })} />
        </td>
        <td><DateInput value={loan.date} label={`Date of the loan to ${loan.who}`} onChange={(v) => update((l) => { l.date = v; })} /></td>
        <td>
          <select className="cell-input" value={loan.direction} aria-label={`Which way the loan with ${loan.who} went`}
            onChange={(e) => update((l) => { l.direction = e.target.value as Loan['direction']; })}>
            <option value="lent">Lent — owed to me</option>
            <option value="borrowed">Borrowed — I owe</option>
          </select>
        </td>
        <td className="fig">
          <span className="unit">
            <NumberInput value={loan.amount} width={92} label={`Amount of the loan with ${loan.who}`}
              onChange={(v) => update((l) => { l.amount = v; })} />
            <button className="tag toggle" title="Switch currency"
              onClick={() => update((l) => { l.currency = l.currency === 'PKR' ? 'USD' : 'PKR'; })}>{loan.currency}</button>
          </span>
        </td>
        <td className="fig mono">{money(r.repaid, loan.currency)}</td>
        <td className={`fig mono total${r.status === 'overpaid' ? ' alloc-off' : ''}`}>{money(r.balance, loan.currency)}</td>
        <td><span className={`loan-status loan-${r.status}`}>{status}</span></td>
        <td><TextInput value={loan.note} placeholder="—" onChange={(v) => update((l) => { l.note = v; })} /></td>
        <td><button className="btn icon" aria-label={`Delete the loan with ${loan.who}`} onClick={remove}>×</button></td>
      </tr>
      {open && (
        <tr className="loan-detail">
          <td colSpan={9}>
            <div className="loan-repayments">
              <table>
                <thead><tr><th>Repaid on</th><th className="fig">Amount</th><th>Note</th><th /></tr></thead>
                <tbody>
                  {[...loan.repayments].sort((a, b) => a.date.localeCompare(b.date)).map((p) => (
                    <tr key={p.id}>
                      <td><DateInput value={p.date} label="Repayment date"
                        onChange={(v) => update((l) => { const x = l.repayments.find((y) => y.id === p.id); if (x) x.date = v; })} /></td>
                      <td className="fig"><NumberInput value={p.amount} width={92} label="Repayment amount" unit={loan.currency}
                        onChange={(v) => update((l) => { const x = l.repayments.find((y) => y.id === p.id); if (x) x.amount = v; })} /></td>
                      <td><TextInput value={p.note} placeholder="—"
                        onChange={(v) => update((l) => { const x = l.repayments.find((y) => y.id === p.id); if (x) x.note = v; })} /></td>
                      <td><button className="btn icon" aria-label="Delete this repayment"
                        onClick={() => { if (confirm(`Delete the repayment of ${money(p.amount, loan.currency)}?`)) update((l) => { l.repayments = l.repayments.filter((y) => y.id !== p.id); }); }}>×</button></td>
                    </tr>
                  ))}
                  {!loan.repayments.length && <tr><td colSpan={4} className="empty">Nothing repaid yet.</td></tr>}
                </tbody>
              </table>
              <form className="loan-form" onSubmit={(e) => { e.preventDefault(); addRepayment(pay.amount); }}>
                <label>
                  <span>Repaid on</span>
                  <DateInput value={pay.date} label="New repayment date" onChange={(v) => setPay({ ...pay, date: v })} />
                </label>
                <label>
                  <span>Amount</span>
                  <span className="unit">
                    <input className="cell-input bordered num" type="number" step="any" min="0"
                      aria-label={`Repayment from ${loan.who}`}
                      value={pay.amount || ''} placeholder={r.balance > 0 ? String(Math.round(r.balance * 100) / 100) : '0'}
                      onChange={(e) => setPay({ ...pay, amount: parseFloat(e.target.value) || 0 })} />
                    <span className="tag">{loan.currency}</span>
                  </span>
                </label>
                <label className="grow">
                  <span>Note</span>
                  <input className="cell-input bordered" value={pay.note} placeholder="optional" aria-label="Repayment note"
                    onChange={(e) => setPay({ ...pay, note: e.target.value })} />
                </label>
                <button className="btn primary" type="submit" disabled={!(pay.amount > 0)}>Record repayment</button>
                {r.balance > 0.005 && (
                  <button className="btn" type="button" onClick={() => addRepayment(Math.round(r.balance * 100) / 100)}>
                    Repaid in full — {money(r.balance, loan.currency)}
                  </button>
                )}
              </form>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Fig({ label, value, sub, lead }: { label: string; value: string; sub?: string; lead?: boolean }) {
  return (
    <div className={`figure${lead ? ' lead' : ''}`}>
      <dt>{label}</dt><dd>{value}</dd>{sub && <small>{sub}</small>}
    </div>
  );
}
