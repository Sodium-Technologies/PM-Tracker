import React from 'react';
import type { AppState, Period } from './lib/types';
import { computePeriod, fmtPkr, fmtUsd } from './lib/calc';
import {
  defaultLabel, emptyState, loadState, newPeriod, normalize, rollForward, saveState, uid,
} from './lib/state';
import { exportWorkbook, importWorkbook } from './lib/xlsx';
import AccountsTable from './components/AccountsTable';
import DivisionMatrix from './components/DivisionMatrix';
import Ledger from './components/Ledger';
import { NumberInput } from './components/Fields';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
type Tab = 'revenue' | 'division' | 'payouts';

export default function App() {
  const [state, setState] = React.useState<AppState>(() => loadState() ?? emptyState());
  const [tab, setTab] = React.useState<Tab>('revenue');
  const [toast, setToast] = React.useState('');
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => { saveState(state); }, [state]);
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const period = state.periods.find((p) => p.id === state.activePeriodId) ?? state.periods[0];
  const result = React.useMemo(() => computePeriod(period), [period]);

  /** Edit the active period through a draft copy, keeping state immutable. */
  const update = (fn: (p: Period) => void) =>
    setState((s) => ({
      ...s,
      periods: s.periods.map((p) => {
        if (p.id !== period.id) return p;
        const draft = clone(p);
        fn(draft);
        return draft;
      }),
    }));

  const addPeriod = () => {
    const p = period.accounts.length ? rollForward(period) : newPeriod(defaultLabel(), period.usdToPkr);
    setState((s) => ({ ...s, periods: [...s.periods, p], activePeriodId: p.id }));
    setToast(period.accounts.length ? `${p.label} started from ${period.label}` : `Created ${p.label}`);
  };

  const duplicatePeriod = () => {
    const p = { ...clone(period), id: uid(), label: `${period.label} (copy)` };
    setState((s) => ({ ...s, periods: [...s.periods, p], activePeriodId: p.id }));
    setToast(`Duplicated ${period.label}`);
  };

  const deletePeriod = () => {
    if (state.periods.length === 1) return;
    if (!confirm(`Delete "${period.label}"? This cannot be undone.`)) return;
    setState((s) => {
      const at = s.periods.findIndex((p) => p.id === period.id);
      const periods = s.periods.filter((p) => p.id !== period.id);
      // Land on the neighbour, not back at the top of the list.
      return { ...s, periods, activePeriodId: periods[Math.min(at, periods.length - 1)].id };
    });
    setToast('Period deleted');
  };

  const onFile = async (file: File) => {
    try {
      if (file.name.endsWith('.json')) {
        const restored = normalize(JSON.parse(await file.text()) as AppState);
        if (!restored.periods?.length) throw new Error('no periods in that backup');
        setState(restored);
        setToast(`Restored ${restored.periods.length} periods from backup`);
        return;
      }
      const periods = await importWorkbook(file);
      if (!periods.length) { setToast('No payroll sheets recognised in that file'); return; }
      setState((s) => ({
        ...s,
        // An untouched starter period is scaffolding, not data — drop it once
        // real periods arrive.
        periods: [...s.periods.filter((p) => p.accounts.length || p.staff.length), ...periods],
        activePeriodId: periods[periods.length - 1].id,
      }));
      setToast(`Imported ${periods.length} period${periods.length > 1 ? 's' : ''}`);
    } catch (e) {
      setToast(`Could not read that file: ${(e as Error).message}`);
    }
  };

  const backup = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pm-payroll-backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
    setToast('Backup downloaded');
  };

  const exportExcel = () => {
    exportWorkbook(state.periods, 'PM Payroll.xlsx');
    setToast(`Exported ${state.periods.length} periods to Excel`);
  };

  return (
    <div className="app">
      <aside className="rail">
        <div className="wordmark">
          <b>PM Payroll</b>
          <span>revenue · division · payouts</span>
        </div>

        <div className="rail-label">Periods</div>
        <nav className="period-list">
          {state.periods.map((p) => {
            const r = computePeriod(p);
            return (
              <button
                key={p.id}
                className={`period${p.id === period.id ? ' active' : ''}`}
                onClick={() => setState((s) => ({ ...s, activePeriodId: p.id }))}
              >
                <span>{p.label}</span>
                <span className="period-sum">{r.totals.earnedUsd ? fmtUsd(r.totals.earnedUsd) : '—'}</span>
              </button>
            );
          })}
        </nav>

        <div className="rail-actions">
          <button className="btn wide primary" onClick={addPeriod}>New period</button>
          <input ref={fileRef} id="import-file" type="file" accept=".xlsx,.xls,.csv,.json" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
          <button className="btn wide" onClick={() => fileRef.current?.click()}>Import sheet or backup</button>
          <button className="btn wide" onClick={exportExcel}>Export Excel</button>
          <button className="btn wide" onClick={backup}>Download backup</button>
        </div>

        <div className="rail-foot">Saved in this browser. Export before switching devices.</div>
      </aside>

      <main className="main">
        <header className="head">
          <input className="period-name" value={period.label} aria-label="Period name"
            onChange={(e) => update((d) => { d.label = e.target.value; })} />
          <div className="rate-field">
            <label htmlFor="usd-pkr">USD → PKR</label>
            <NumberInput id="usd-pkr" value={period.usdToPkr} width={62}
              onChange={(v) => update((d) => { d.usdToPkr = v; })} />
          </div>
          <div className="spacer" />
          <button className="btn" onClick={duplicatePeriod}>Duplicate</button>
          <button className="btn" onClick={deletePeriod} disabled={state.periods.length === 1}>Delete</button>
        </header>

        <dl className="figures">
          <Figure label="Earned" value={fmtUsd(result.totals.earnedUsd)} sub={fmtPkr(result.totals.earnedPkr)} />
          <Figure label="Team pool" value={fmtPkr(result.totals.freelancerPkr)} sub={fmtUsd(result.totals.freelancerUsd)} />
          <Figure label="Company share" value={fmtPkr(result.totals.companyPkr)} sub={fmtUsd(result.totals.companyUsd)} />
          <Figure label="Owed this period" value={fmtPkr(result.ledger.transferablePkr)}
            sub={`${period.staff.length} people · ${period.accounts.length} accounts`} />
          <Figure label="Still to remit" value={fmtPkr(result.ledger.remainingPkr)}
            sub={`of ${fmtPkr(result.ledger.transferablePkr)}`}
            lead negative={result.ledger.remainingPkr < 0} />
        </dl>

        {result.warnings.length > 0 && (
          <ul className="notices">
            {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}

        <nav className="tabs">
          {([['revenue', 'Revenue'], ['division', 'Division'], ['payouts', 'Payouts & settlement']] as const)
            .map(([id, label]) => (
              <button key={id} className={`tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
        </nav>

        <div className="sheet">
          {tab === 'revenue' && <AccountsTable result={result} update={update} />}
          {tab === 'division' && <DivisionMatrix period={period} result={result} update={update} />}
          {tab === 'payouts' && <Ledger period={period} result={result} update={update} />}
        </div>
      </main>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function Figure({ label, value, sub, lead, negative }: {
  label: string; value: string; sub?: string; lead?: boolean; negative?: boolean;
}) {
  return (
    <div className={`figure${lead ? ' lead' : ''}${negative ? ' negative' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {sub && <small>{sub}</small>}
    </div>
  );
}
