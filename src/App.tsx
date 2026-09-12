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

export default function App() {
  const [state, setState] = React.useState<AppState>(() => loadState() ?? emptyState());
  const [tab, setTab] = React.useState<'revenue' | 'division' | 'payouts'>('revenue');
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

  /** Mutate the active period immutably: callers edit a draft copy. */
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
    const p = period.accounts.length
      ? rollForward(period)
      : newPeriod(defaultLabel(), period.usdToPkr);
    setState((s) => ({ ...s, periods: [...s.periods, p], activePeriodId: p.id }));
    setToast(period.accounts.length ? `Rolled forward into ${p.label}` : `Created ${p.label}`);
  };

  const duplicatePeriod = () => {
    const p = { ...clone(period), id: uid(), label: `${period.label} (copy)` };
    setState((s) => ({ ...s, periods: [...s.periods, p], activePeriodId: p.id }));
  };

  const deletePeriod = () => {
    if (state.periods.length === 1) return;
    if (!confirm(`Delete "${period.label}"? This cannot be undone.`)) return;
    setState((s) => {
      const periods = s.periods.filter((p) => p.id !== period.id);
      return { ...s, periods, activePeriodId: periods[0].id };
    });
  };

  const onImport = async (file: File) => {
    try {
      if (file.name.endsWith('.json')) {
        const restored = normalize(JSON.parse(await file.text()) as AppState);
        if (!restored.periods?.length) throw new Error('no periods in that backup');
        setState(restored);
        setToast(`Restored ${restored.periods.length} periods from backup.`);
        return;
      }
      const periods = await importWorkbook(file);
      if (!periods.length) { setToast('No payroll sheets recognised in that file.'); return; }
      setState((s) => ({ ...s, periods: [...s.periods, ...periods], activePeriodId: periods[periods.length - 1].id }));
      setToast(`Imported ${periods.length} period${periods.length > 1 ? 's' : ''}.`);
    } catch (e) {
      setToast(`Import failed: ${(e as Error).message}`);
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pm-payroll-backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <strong>PM Payroll</strong>
          <span className="muted">revenue → splits → payouts</span>
        </div>
        <div className="actions">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.json" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ''; }} />
          <button className="btn" onClick={() => fileRef.current?.click()}>Import sheet / backup</button>
          <button className="btn" onClick={() => exportWorkbook(state.periods, 'PM Payroll.xlsx')}>Export Excel</button>
          <button className="btn ghost" onClick={exportJson}>Backup</button>
        </div>
      </header>

      <nav className="periods">
        {state.periods.map((p) => (
          <button key={p.id}
            className={`period ${p.id === period.id ? 'active' : ''}`}
            onClick={() => setState((s) => ({ ...s, activePeriodId: p.id }))}>
            {p.label}
          </button>
        ))}
        <button className="period add" onClick={addPeriod} title="Start the next month, carrying accounts and splits forward">+ Next period</button>
      </nav>

      <div className="period-bar">
        <input className="period-name" value={period.label}
          onChange={(e) => update((d) => { d.label = e.target.value; })} />
        <label className="inline">
          USD → PKR
          <NumberInput value={period.usdToPkr} onChange={(v) => update((d) => { d.usdToPkr = v; })} width={90} />
        </label>
        <div className="spacer" />
        <button className="btn ghost" onClick={duplicatePeriod}>Duplicate</button>
        <button className="btn ghost danger" onClick={deletePeriod} disabled={state.periods.length === 1}>Delete period</button>
      </div>

      <div className="stats">
        <Stat label="Earned" value={fmtUsd(result.totals.earnedUsd)} sub={fmtPkr(result.totals.earnedPkr)} />
        <Stat label="Freelancer pool" value={fmtPkr(result.totals.freelancerPkr)} sub={fmtUsd(result.totals.freelancerUsd)} />
        <Stat label="Company share" value={fmtPkr(result.totals.companyPkr)} sub={fmtUsd(result.totals.companyUsd)} />
        <Stat label="Staff payouts" value={fmtPkr(result.totals.staffPayPkr)} sub={`${period.staff.length} people`} />
        <Stat label="Still to remit" value={fmtPkr(result.ledger.remainingPkr)} sub={`of ${fmtPkr(result.ledger.transferablePkr)} owed`} />
      </div>

      {result.warnings.length > 0 && (
        <ul className="warnings">
          {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}

      <nav className="tabs">
        {(['revenue', 'division', 'payouts'] as const).map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'revenue' ? 'Revenue' : t === 'division' ? 'Division' : 'Payouts & settlement'}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'revenue' && <AccountsTable period={period} result={result} update={update} />}
        {tab === 'division' && <DivisionMatrix period={period} result={result} update={update} />}
        {tab === 'payouts' && <Ledger period={period} result={result} update={update} />}
      </main>

      <footer className="foot muted small">
        Saved in this browser only. Export to Excel or Backup before switching devices.
      </footer>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub muted">{sub}</div>}
    </div>
  );
}
