import React from 'react';
import type { AppState, Period } from './lib/types';
import { computePeriod, fmtPkr, fmtUsd, negativePkr } from './lib/calc';
import {
  defaultLabel, emptyState, loadState, newPeriod, normalize, rollForward, saveState, uid,
} from './lib/state';
import { exportWorkbook, importWorkbook } from './lib/xlsx';
import { cloudEnabled } from './lib/supabase';
import { useAuth } from './lib/auth';
import { AccessContext } from './lib/access';
import * as cloud from './lib/cloud';
import AccountsTable from './components/AccountsTable';
import Analytics from './components/Analytics';
import DivisionMatrix from './components/DivisionMatrix';
import Ledger from './components/Ledger';
import Mark from './components/Mark';
import Overview from './components/Overview';
import People from './components/People';
import SignIn from './components/SignIn';
import { NumberInput } from './components/Fields';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
/** The app has two places to stand: the whole business (Dashboard, and who can
 *  open the books), or one month. Tabs belong to a month and never leave it. */
type View = 'dashboard' | 'month' | 'access';
type Tab = 'overview' | 'revenue' | 'division' | 'payouts';

export default function App() {
  const auth = useAuth();

  if (cloudEnabled) {
    if (auth.loading) return <div className="booting">Loading…</div>;
    if (auth.error) return <SignIn configError={auth.error} />;
    if (!auth.session) return <SignIn />;
    if (!auth.role) return <SignIn email={auth.email} noAccess onSignOut={auth.signOut} />;
  }
  return <Payroll auth={auth} />;
}

function Payroll({ auth }: { auth: ReturnType<typeof useAuth> }) {
  // Without Supabase configured the app is a local tool, and whoever opens it
  // owns their own copy — so everything is editable.
  const canEdit = cloudEnabled ? auth.canEdit : true;
  const [state, setState] = React.useState<AppState>(() => (cloudEnabled ? emptyState() : loadState() ?? emptyState()));
  // A saved state with nothing in it is not data — someone who opened the page
  // once before should still get the seed.
  const [hadSaved] = React.useState(() => {
    const saved = loadState();
    return !!saved?.periods?.some((p) => p.accounts.length || p.staff.length);
  });
  const [syncing, setSyncing] = React.useState(cloudEnabled);
  // Opens on the open month's summary: most visits are to find out where a month
  // stands, not to read the history or type into the ledger.
  const [view, setView] = React.useState<View>('month');
  const [tab, setTab] = React.useState<Tab>('overview');
  const openMonth = (id: string) => {
    setState((s) => ({ ...s, activePeriodId: id }));
    setView('month');
  };
  const [toast, setToast] = React.useState('');
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => { if (!cloudEnabled) saveState(state); }, [state]);

  // A fresh browser starts from seed.json when the deployment ships one, so the
  // app opens on real periods instead of an empty month. It is data, not code —
  // replace the file to change what a new visitor sees.
  React.useEffect(() => {
    if (cloudEnabled || hadSaved) return;
    let cancelled = false;
    fetch('./seed.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: AppState | null) => {
        if (cancelled || !data?.periods?.length) return;
        setState(normalize(data));
        setToast(`Loaded ${data.periods.length} months`);
      })
      .catch(() => { /* no seed shipped — start empty */ });
    return () => { cancelled = true; };
  }, [hadSaved]);
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Shared books: read from the database, and follow anyone else's edits.
  const reload = React.useCallback(async () => {
    const { periods, error } = await cloud.fetchPeriods();
    if (error) { setToast(error); setSyncing(false); return; }
    setState((s) => (periods.length ? cloud.stateFrom(periods, s.activePeriodId) : s));
    setSyncing(false);
  }, []);

  React.useEffect(() => {
    if (!cloudEnabled) return;
    void reload();
    return cloud.watchPeriods(() => { void reload(); });
  }, [reload]);

  const period = state.periods.find((p) => p.id === state.activePeriodId) ?? state.periods[0];
  const result = React.useMemo(() => computePeriod(period), [period]);

  /** Edit the active period through a draft copy, keeping state immutable.
   *  Shared edits are written back debounced, so typing does not become a write
   *  per keystroke. */
  const pending = React.useRef<Period | null>(null);
  const flushTimer = React.useRef<number | undefined>(undefined);

  const update = (fn: (p: Period) => void) => {
    if (!canEdit) return;
    setState((s) => ({
      ...s,
      periods: s.periods.map((p) => {
        if (p.id !== period.id) return p;
        const draft = clone(p);
        fn(draft);
        if (cloudEnabled) {
          pending.current = draft;
          window.clearTimeout(flushTimer.current);
          flushTimer.current = window.setTimeout(async () => {
            const toSave = pending.current;
            pending.current = null;
            if (!toSave) return;
            const { error } = await cloud.savePeriod(toSave);
            if (error) setToast(`Not saved: ${error}`);
          }, 600);
        }
        return draft;
      }),
    }));
  };

  const addPeriod = async () => {
    const p = period.accounts.length ? rollForward(period) : newPeriod(defaultLabel(), period.usdToPkr);
    setState((s) => ({ ...s, periods: [...s.periods, p], activePeriodId: p.id }));
    setToast(period.accounts.length ? `${p.label} started from ${period.label}` : `Created ${p.label}`);
    if (cloudEnabled) await cloud.savePeriod(p);
  };

  const duplicatePeriod = async () => {
    const p = { ...clone(period), id: uid(), label: `${period.label} (copy)` };
    setState((s) => ({ ...s, periods: [...s.periods, p], activePeriodId: p.id }));
    setToast(`Duplicated ${period.label}`);
    if (cloudEnabled) await cloud.savePeriod(p);
  };

  const deletePeriod = async () => {
    if (state.periods.length === 1) return;
    if (!confirm(`Delete ${period.label}? This cannot be undone.`)) return;
    const removing = period.id;
    setState((s) => {
      const at = s.periods.findIndex((p) => p.id === period.id);
      const periods = s.periods.filter((p) => p.id !== period.id);
      // Land on the neighbour, not back at the top of the list.
      return { ...s, periods, activePeriodId: periods[Math.min(at, periods.length - 1)].id };
    });
    setToast('Month deleted');
    if (cloudEnabled) {
      const { error } = await cloud.deletePeriod(removing);
      if (error) setToast(`Not deleted: ${error}`);
    }
  };

  const onFile = async (file: File) => {
    try {
      if (file.name.endsWith('.json')) {
        const restored = normalize(JSON.parse(await file.text()) as AppState);
        if (!restored.periods?.length) throw new Error('no periods in that backup');
        setState(restored);
        setToast(`Restored ${restored.periods.length} months from the backup`);
        if (cloudEnabled) {
          const { error } = await cloud.uploadPeriods(restored.periods);
          if (error) setToast(`Restored locally, but not shared: ${error}`);
        }
        return;
      }
      const periods = await importWorkbook(file);
      if (!periods.length) { setToast('That file has no payroll months in it'); return; }
      setState((s) => ({
        ...s,
        // An untouched starter period is scaffolding, not data — drop it once
        // real periods arrive.
        periods: [...s.periods.filter((p) => p.accounts.length || p.staff.length), ...periods],
        activePeriodId: periods[periods.length - 1].id,
      }));
      setToast(`Loaded ${periods.length} month${periods.length > 1 ? 's' : ''}`);
      if (cloudEnabled) {
        const { error } = await cloud.uploadPeriods(periods);
        setToast(error ? `Loaded, but not shared: ${error}` : `Loaded ${periods.length} months — everyone with access can see them`);
      }
    } catch (e) {
      setToast(`Could not read that file: ${(e as Error).message}`);
    }
  };

  /** Marking somebody's wages as settled locally is a standing arrangement, not a
   *  monthly decision — this applies the current period's marks to every period,
   *  matching people by name. */
  const applyPaidHereEverywhere = async () => {
    const names = new Set(
      period.staff.filter((m) => m.retained).map((m) => m.name.trim().toLowerCase()),
    );
    if (!names.size) { setToast('Nobody is marked as paid here yet'); return; }

    const changed: Period[] = [];
    setState((s) => ({
      ...s,
      periods: s.periods.map((p) => {
        if (!p.staff.some((m) => names.has(m.name.trim().toLowerCase()) && !m.retained)) return p;
        const draft = clone(p);
        draft.staff.forEach((m) => {
          if (names.has(m.name.trim().toLowerCase())) m.retained = true;
        });
        changed.push(draft);
        return draft;
      }),
    }));

    const who = [...names].join(', ');
    if (cloudEnabled && changed.length) {
      const { error } = await cloud.uploadPeriods(changed);
      setToast(error ? `Applied locally, not shared: ${error}` : `${who} marked as paid here in ${changed.length} more periods`);
    } else {
      setToast(changed.length ? `${who} marked as paid here in ${changed.length} more periods` : 'Already applied everywhere');
    }
  };

  const backup = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cko-pm-payroll-backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
    setToast('Backup downloaded');
  };

  const exportExcel = () => {
    exportWorkbook(state.periods, 'CKO PM Payroll.xlsx');
    setToast(`Downloaded ${state.periods.length} months as Excel`);
  };

  return (
    <AccessContext.Provider value={canEdit}>
    <div className="app">
      <aside className="rail">
        <div className="wordmark">
          <Mark />
          <div>
            <b>CKO PM Payroll</b>
            <span>payroll ledger</span>
          </div>
        </div>

        <nav className="rail-nav">
          <button className={`rail-link${view === 'dashboard' ? ' active' : ''}`}
            onClick={() => setView('dashboard')}>Dashboard</button>
        </nav>

        <div className="rail-label">Months</div>
        <nav className="period-list">
          {state.periods.map((p, i) => {
            const r = computePeriod(p);
            const year = p.label.match(/\d{4}/)?.[0];
            const previousYear = state.periods[i - 1]?.label.match(/\d{4}/)?.[0];
            return (
              <React.Fragment key={p.id}>
                {year && year !== previousYear && <div className="year-mark">{year}</div>}
                <button
                  className={`period${view === 'month' && p.id === period.id ? ' active' : ''}`}
                  onClick={() => openMonth(p.id)}
                >
                  <span>{p.label.replace(/\s*\d{4}$/, '').replace(/^PM - /, '')}</span>
                  <span className="period-sum">{r.totals.earnedUsd ? fmtUsd(r.totals.earnedUsd) : '—'}</span>
                </button>
              </React.Fragment>
            );
          })}
        </nav>

        <div className="rail-actions">
          {canEdit && <button className="btn wide primary" onClick={addPeriod}>Start a new month</button>}
          <input ref={fileRef} id="import-file" type="file" accept=".xlsx,.xls,.csv,.json" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
          {canEdit && (
            <button className="btn wide" onClick={() => fileRef.current?.click()}>Load a sheet or backup</button>
          )}
          <button className="btn wide" onClick={exportExcel}>Download as Excel</button>
          <button className="btn wide" onClick={backup}>Save a backup</button>
          {auth.isSuperAdmin && (
            <button className={`btn wide${view === 'access' ? ' primary' : ''}`}
              onClick={() => setView(view === 'access' ? 'month' : 'access')}>
              Who can open this
            </button>
          )}
        </div>

        {cloudEnabled ? (
          <div className="rail-foot who">
            <div className="who-email">{auth.email}</div>
            <div className="who-role">
              <span className={`role role-${auth.role}`}>{roleLabel(auth.role)}</span>
              {syncing && <span className="syncing"> · loading…</span>}
            </div>
            <button className="link" onClick={auth.signOut}>Sign out</button>
          </div>
        ) : (
          <div className="rail-foot">Saved in this browser only. Download a backup before switching devices.</div>
        )}
      </aside>

      <main className="main">
        {!cloudEnabled && (
          <div className="mode-banner">
            <b>Local mode — no sign-in, nothing shared.</b> Everything here lives in this
            browser only, and anyone who opens this page sees it. To share it with
            other people, set <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> and rebuild.
          </div>
        )}

        {view === 'dashboard' && (
          <>
            <header className="head">
              <h1 className="view-name">Dashboard</h1>
              <span className="hint">every month together — nothing here belongs to one month</span>
              <div className="spacer" />
              <button className="btn" onClick={() => setView('month')}>Open {period.label}</button>
            </header>
            <div className="sheet">
              <Analytics periods={state.periods} onPick={openMonth} />
            </div>
          </>
        )}

        {view === 'access' && auth.isSuperAdmin && (
          <>
            <header className="head">
              <h1 className="view-name">Who can open this</h1>
              <div className="spacer" />
              <button className="btn" onClick={() => setView('month')}>Back to {period.label}</button>
            </header>
            <div className="sheet">
              <People me={auth.email} onChanged={auth.refreshRole} />
            </div>
          </>
        )}

        {view === 'month' && (
          <>
            <header className="head">
              <input className="period-name" value={period.label} aria-label="Period name"
                onChange={(e) => update((d) => { d.label = e.target.value; })} />
              <div className="rate-field">
                <label htmlFor="usd-pkr">$1 =</label>
                <NumberInput id="usd-pkr" value={period.usdToPkr} width={62}
                  onChange={(v) => update((d) => { d.usdToPkr = v; })} />
                <span className="tag">PKR</span>
              </div>
              <label className="rate-field" htmlFor="time-format">
                <span>Time written as</span>
                <select id="time-format" className="cell-input" value={period.timeFormat}
                  disabled={!canEdit}
                  onChange={(e) => update((d) => { d.timeFormat = e.target.value as Period['timeFormat']; })}>
                  <option value="hm">12.20 = 12 hours 20 minutes</option>
                  <option value="decimal">12.20 = 12.2 hours</option>
                </select>
              </label>
              <div className="spacer" />
              {canEdit ? (
                <>
                  <button className="btn" onClick={duplicatePeriod}>Duplicate</button>
                  <button className="btn" onClick={deletePeriod} disabled={state.periods.length === 1}>Delete</button>
                </>
              ) : (
                <span className="readonly-badge">You can look, not change</span>
              )}
            </header>

            <dl className="figures">
              <Figure label="Money earned" value={fmtUsd(result.totals.earnedUsd)} sub={fmtPkr(result.totals.earnedPkr)} />
              <Figure label="The team's share" value={fmtPkr(result.totals.freelancerPkr)} sub={fmtUsd(result.totals.freelancerUsd)} />
              <Figure label="The company's share" value={fmtPkr(result.totals.companyPkr)} sub={fmtUsd(result.totals.companyUsd)} />
              <Figure label="Total to pay out" value={fmtPkr(result.ledger.transferablePkr)}
                sub={`${period.staff.length} people · ${period.accounts.length} clients`} />
              <Figure label="Left to send" value={fmtPkr(result.ledger.remainingPkr)}
                sub={`of ${fmtPkr(result.ledger.receivedPkr)} received`}
                lead negative={negativePkr(result.ledger.remainingPkr)} />
            </dl>

            {result.warnings.length > 0 && (
              <ul className="notices">
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}

            <nav className="tabs">
              {([
                ['overview', 'Summary'],
                ['revenue', 'Revenue'],
                ['division', 'Payrolls'],
                ['payouts', 'Distributions'],
              ] as const).map(([id, label]) => (
                <button key={id} className={`tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id as Tab)}>
                  {label}
                </button>
              ))}
            </nav>

            <div className="sheet">
              {tab === 'overview' && <Overview periods={state.periods} period={period} result={result} />}
              {tab === 'revenue' && (
                <AccountsTable result={result} update={update} timeFormat={period.timeFormat} />
              )}
              {tab === 'division' && (
                <DivisionMatrix period={period} result={result} update={update}
                  onApplyPaidHereEverywhere={applyPaidHereEverywhere} />
              )}
              {tab === 'payouts' && <Ledger period={period} result={result} update={update} />}
            </div>
          </>
        )}
      </main>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
    </AccessContext.Provider>
  );
}

function roleLabel(role: string | null) {
  if (role === 'super_admin') return 'Runs it';
  if (role === 'editor') return 'Can change';
  if (role === 'viewer') return 'Can look';
  return 'No access';
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
