import React from 'react';
import type { Period } from '../lib/types';
import { computePeriod, fmtPkr, fmtUsd, round2, type PeriodResult } from '../lib/calc';

/** The page someone opens to find out where things stand, without reading a
 *  spreadsheet: what came in, what is still outstanding, who is owed what, and
 *  how this month compares with the ones before it. */
export default function Overview({ periods, period, result, onPick }: {
  periods: Period[];
  period: Period;
  result: PeriodResult;
  onPick: (id: string) => void;
}) {
  // Only real months belong on a time axis; a legacy summary tab would sit on it
  // as a bar that means nothing. It stays in the period list either way.
  const isMonth = (label: string) => /[A-Za-z]+\s+\d{4}/.test(label);
  const history = React.useMemo(
    () => periods
      .filter((p) => isMonth(p.label))
      .map((p) => ({ period: p, totals: computePeriod(p).totals })),
    [periods],
  );

  const outstanding = result.accounts.filter(
    (a) => a.earnedUsd > 0 && !/received/i.test(a.account.status),
  );
  const received = result.accounts.filter((a) => /received/i.test(a.account.status));
  const outstandingUsd = round2(outstanding.reduce((t, a) => t + a.earnedUsd, 0));

  const paid = [...result.staff].sort((a, b) => b.payPkr - a.payPkr);
  const topPay = paid[0]?.payPkr || 1;

  const at = history.findIndex((h) => h.period.id === period.id);
  const previous = at > 0 ? history[at - 1] : undefined;
  const change = previous?.totals.earnedUsd
    ? round2(((result.totals.earnedUsd - previous.totals.earnedUsd) / previous.totals.earnedUsd) * 100)
    : null;

  return (
    <div className="overview">
      <section className="panel span-2">
        <div className="panel-head">
          <h2>Earned by period <span className="hint">USD invoiced, after fees</span></h2>
          <span className="hint">select a bar to open that period</span>
        </div>
        <Trend history={history} activeId={period.id} onPick={onPick} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>This period</h2>
          {change !== null && (
            <span className={`delta ${change >= 0 ? 'up' : 'down'}`}>
              {change >= 0 ? '▲' : '▼'} {Math.abs(change)}% vs {previous?.period.label}
            </span>
          )}
        </div>
        <dl className="settle">
          <div className="row"><dt>Earned</dt><dd>{fmtUsd(result.totals.earnedUsd)}</dd></div>
          <div className="row"><dt>Team pool</dt><dd>{fmtPkr(result.totals.freelancerPkr)}</dd></div>
          <div className="row"><dt>Company share</dt><dd>{fmtPkr(result.totals.companyPkr)}</dd></div>
          <div className="row rule"><dt>Owed this period</dt><dd>{fmtPkr(result.ledger.transferablePkr)}</dd></div>
          <div className={`row final${result.ledger.remainingPkr < 0 ? ' negative' : ''}`}>
            <dt>Still to remit</dt><dd>{fmtPkr(result.ledger.remainingPkr)}</dd>
          </div>
        </dl>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Collection</h2>
          <span className="hint">{received.length} of {result.accounts.length} received</span>
        </div>
        {outstanding.length > 0 ? (
          <>
            <p className="collect-lead">
              <b>{fmtUsd(outstandingUsd)}</b> still to come in, across {outstanding.length}{' '}
              {outstanding.length === 1 ? 'account' : 'accounts'}.
            </p>
            <ul className="chips">
              {outstanding.map((a) => (
                <li key={a.account.id}>
                  <span className={`dot s-${a.account.status.replace(/\s+/g, '-').toLowerCase()}`} />
                  <span className="chip-name">{a.account.name}</span>
                  <span className="chip-fig mono">{fmtUsd(a.earnedUsd)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="collect-lead">Everything invoiced this period has been received.</p>
        )}
      </section>

      <section className="panel span-2">
        <div className="panel-head">
          <h2>Who is owed what</h2>
          <span className="hint">this period, in PKR</span>
        </div>
        <ul className="paybars">
          {paid.map((s) => (
            <li key={s.staff.id}>
              <span className="pay-name">
                {s.staff.name}
                {s.staff.retained && <span className="tag-inline">kept local</span>}
              </span>
              <span className="pay-track">
                <span className="pay-fill" style={{ width: `${Math.max(2, (s.payPkr / topPay) * 100)}%` }} />
              </span>
              <span className="pay-fig mono">{fmtPkr(s.payPkr)}</span>
            </li>
          ))}
          {!paid.length && <li className="empty">Nobody assigned a share yet.</li>}
        </ul>
      </section>
    </div>
  );
}

/** One series, so no legend — the heading names it. Bars carry the hover and the
 *  click; the active period is the only one in full accent. */
function Trend({ history, activeId, onPick }: {
  history: { period: Period; totals: { earnedUsd: number; earnedPkr: number } }[];
  activeId: string;
  onPick: (id: string) => void;
}) {
  const [hover, setHover] = React.useState<number | null>(null);
  if (!history.length) return <p className="empty">No periods yet.</p>;

  const W = 760;
  const H = 210;
  const padL = 54;
  const padR = 12;
  const padT = 14;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const max = Math.max(...history.map((h) => h.totals.earnedUsd), 1);
  const ceiling = Math.ceil(max / 1000) * 1000 || 1000;
  const band = plotW / history.length;
  const barW = Math.max(6, Math.min(44, band - 10));
  const y = (v: number) => padT + plotH - (v / ceiling) * plotH;

  const ticks = [0, ceiling / 2, ceiling];
  const shortLabel = (label: string) => {
    const m = label.match(/([A-Za-z]+)\s+(\d{4})/);
    return m ? `${m[1].slice(0, 3)} ${m[2].slice(2)}` : label.slice(0, 7);
  };

  const active = hover ?? history.findIndex((h) => h.period.id === activeId);

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img"
        aria-label="Earned in US dollars for each period">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="grid" />
            <text x={padL - 8} y={y(t) + 4} className="axis" textAnchor="end">
              ${Math.round(t / 1000)}k
            </text>
          </g>
        ))}

        {history.map((h, i) => {
          const x = padL + i * band + (band - barW) / 2;
          const top = y(h.totals.earnedUsd);
          const isActive = h.period.id === activeId;
          return (
            <g key={h.period.id}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onPick(h.period.id)}
              className="bar-group">
              <rect x={padL + i * band} y={padT} width={band} height={plotH} className="bar-hit" />
              <rect
                x={x} y={top} width={barW} height={Math.max(2, padT + plotH - top)}
                rx={4}
                className={`bar${isActive ? ' active' : ''}${hover === i ? ' hover' : ''}`}
              />
              <text x={x + barW / 2} y={H - 12} className="axis" textAnchor="middle">
                {shortLabel(h.period.label)}
              </text>
              <title>{`${h.period.label}: ${fmtUsd(h.totals.earnedUsd)}`}</title>
            </g>
          );
        })}
      </svg>

      {active >= 0 && history[active] && (
        <p className="chart-read">
          <b>{history[active].period.label}</b>
          <span className="mono">{fmtUsd(history[active].totals.earnedUsd)}</span>
          <span className="mono muted">{fmtPkr(history[active].totals.earnedPkr)}</span>
        </p>
      )}
    </div>
  );
}
