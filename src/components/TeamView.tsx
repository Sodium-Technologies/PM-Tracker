import React from 'react';
import { fmtPkr, fmtUsd, round2 } from '../lib/calc';
import { hoursAsText } from '../lib/time';
import { fetchTeamPay, type TeamSummary } from '../lib/team';
import { fmtCycle } from '../lib/cycle';
import Mark from './Mark';

/** All a team member ever sees: their own pay, month by month, and the projects
 *  it came from. The database sends nothing else — not the books, not anyone
 *  else's pay — so there is nothing here to hide. */
export default function TeamView({ email, staffName, onSignOut }: {
  email: string | null;
  staffName: string | null;
  onSignOut: () => void;
}) {
  const [months, setMonths] = React.useState<TeamSummary[] | null>(null);
  const [error, setError] = React.useState('');
  const [open, setOpen] = React.useState<string | null>(null);

  React.useEffect(() => {
    void fetchTeamPay().then(({ months: m, error: e }) => {
      setMonths(m);
      if (e) setError(e);
      setOpen(m[m.length - 1]?.label ?? null);
    });
  }, []);

  const totalPkr = (months ?? []).reduce((t, m) => t + m.payPkr, 0);
  const totalUsd = (months ?? []).reduce((t, m) => t + m.payUsd, 0);
  const owedPkr = (months ?? []).reduce((t, m) => t + m.stillOwedPkr, 0);
  const byProject = new Map<string, { pkr: number; usd: number; hours: number }>();
  for (const m of months ?? []) for (const p of m.projects) {
    const x = byProject.get(p.name) ?? { pkr: 0, usd: 0, hours: 0 };
    byProject.set(p.name, { pkr: x.pkr + p.earnedPkr, usd: x.usd + p.earnedUsd, hours: x.hours + p.hours });
  }
  const month = months?.find((m) => m.label === open) ?? null;

  return (
    <div className="team-app">
      <header className="team-head">
        <div className="wordmark">
          <Mark />
          <div><b>CKO PM Payroll</b><span>{staffName ?? 'your pay'}</span></div>
        </div>
        <div className="spacer" />
        <span className="who-email">{email}</span>
        <span className="role role-viewer">Team</span>
        <button className="link" onClick={onSignOut}>Sign out</button>
      </header>

      <main className="sheet team-sheet">
        {!staffName && (
          <p className="notices">Your access isn't linked to anyone on the payroll yet. Ask the super admin to pick your name.</p>
        )}
        {error && <p className="notices">Could not load your pay: {error}</p>}
        {months === null && <p className="hint">Loading…</p>}
        {months && !months.length && staffName && (
          <p className="panel collect-lead">Nothing has been shared with the team yet.</p>
        )}

        {months && months.length > 0 && (
          <>
            <dl className="figures">
              <Fig label="Earned in total" value={fmtPkr(totalPkr)} sub={fmtUsd(totalUsd)} lead />
              <Fig label="Still owed to you" value={fmtPkr(owedPkr)} sub={`over ${months.length} month${months.length > 1 ? 's' : ''}`} />
              <Fig label="Projects" value={String(byProject.size)} />
            </dl>

            <section className="panel">
              <div className="panel-head"><h2>By project <span className="hint">every month together</span></h2></div>
              <div className="scroll">
                <table>
                  <thead><tr><th>Project</th><th className="fig">Hours</th><th className="fig">PKR</th><th className="fig">USD</th></tr></thead>
                  <tbody>
                    {[...byProject.entries()].sort((a, b) => b[1].pkr - a[1].pkr).map(([name, x]) => (
                      <tr key={name}>
                        <td>{name}</td>
                        <td className="fig mono">{hoursAsText(x.hours)}</td>
                        <td className="fig mono">{fmtPkr(x.pkr)}</td>
                        <td className="fig mono">{fmtUsd(x.usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2>Month by month</h2>
                <select className="cell-input bordered" value={open ?? ''} aria-label="Month"
                  onChange={(e) => setOpen(e.target.value)}>
                  {months.map((m) => <option key={m.label} value={m.label}>{m.label}</option>)}
                </select>
              </div>
              {month && (
                <>
                  <div className="scroll">
                    <table>
                      <thead><tr><th>Project</th><th>Billing cycle</th><th className="fig">Hours</th><th className="fig">Your share</th><th className="fig">PKR</th><th className="fig">USD</th></tr></thead>
                      <tbody>
                        {month.projects.map((p) => (
                          <tr key={p.name}>
                            <td>{p.name}</td>
                            <td className="mono">{fmtCycle(p.cycleStart ?? '', p.cycleEnd ?? '') || '—'}</td>
                            <td className="fig mono">{hoursAsText(p.hours)}</td>
                            <td className="fig mono">{round2(p.sharePct)}%</td>
                            <td className="fig mono">{fmtPkr(p.earnedPkr)}</td>
                            <td className="fig mono">{fmtUsd(p.earnedUsd)}</td>
                          </tr>
                        ))}
                        {!month.projects.length && <tr><td colSpan={6} className="empty">No projects this month.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <dl className="settle">
                    {Math.round(month.adjustmentPkr) !== 0 && (
                      <div className="row"><dt>Adjustment</dt><dd className="mono">{fmtPkr(month.adjustmentPkr)}</dd></div>
                    )}
                    <div className="row"><dt>Your pay</dt><dd className="mono">{fmtPkr(month.payPkr)} · {fmtUsd(month.payUsd)}</dd></div>
                    <div className="row"><dt>Taken already</dt><dd className="mono">{fmtPkr(month.takenPkr)}</dd></div>
                    <div className="row"><dt>Still owed</dt><dd className="mono">{fmtPkr(month.stillOwedPkr)}</dd></div>
                  </dl>
                </>
              )}
            </section>
          </>
        )}
        <div className="build">version {__BUILD__}</div>
      </main>
    </div>
  );
}

function Fig({ label, value, sub, lead }: { label: string; value: string; sub?: string; lead?: boolean }) {
  return (
    <div className={`figure${lead ? ' lead' : ''}`}>
      <dt>{label}</dt><dd>{value}</dd>{sub && <small>{sub}</small>}
    </div>
  );
}
