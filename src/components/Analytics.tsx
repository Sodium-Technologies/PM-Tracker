import React from 'react';
import type { Period } from '../lib/types';
import { computePeriod, fmtPkr, fmtUsd, round2 } from '../lib/calc';
import { hoursAsText } from '../lib/time';

interface MonthStat {
  period: Period;
  label: string;
  short: string;
  earnedUsd: number;
  teamPkr: number;
  companyPkr: number;
  hours: number;
  /** client name -> earned USD that month */
  byClient: Map<string, number>;
  /** person name -> pay PKR that month */
  byPerson: Map<string, number>;
}

/** What the months add up to: how the business is doing, where the money comes
 *  from, and which way each line is moving. */
export default function Analytics({ periods, onPick }: {
  periods: Period[];
  onPick: (id: string) => void;
}) {
  const months = React.useMemo<MonthStat[]>(() => periods
    .filter((p) => /[A-Za-z]+\s+\d{4}/.test(p.label))
    .map((p) => {
      const r = computePeriod(p);
      const m = p.label.match(/([A-Za-z]+)\s+(\d{4})/)!;
      return {
        period: p,
        label: p.label,
        short: `${m[1].slice(0, 3)} ${m[2].slice(2)}`,
        earnedUsd: r.totals.earnedUsd,
        teamPkr: r.totals.freelancerPkr,
        companyPkr: r.totals.companyPkr,
        hours: r.accounts.reduce((t, a) => t + a.units, 0),
        byClient: new Map(r.accounts.map((a) => [a.account.name.trim(), a.earnedUsd])),
        byPerson: new Map(r.staff.map((s) => [s.staff.name.trim(), s.payPkr])),
      };
    }), [periods]);

  if (months.length < 2) {
    return (
      <div className="panel">
        <p className="collect-lead">
          Two months are needed before anything can be compared. Load a sheet, or start
          a second month.
        </p>
      </div>
    );
  }

  const latest = months[months.length - 1];
  const previous = months[months.length - 2];
  const totalUsd = months.reduce((t, m) => t + m.earnedUsd, 0);
  const totalHours = months.reduce((t, m) => t + m.hours, 0);
  const best = months.reduce((a, b) => (b.earnedUsd > a.earnedUsd ? b : a));
  const growth = previous.earnedUsd
    ? ((latest.earnedUsd - previous.earnedUsd) / previous.earnedUsd) * 100
    : 0;
  // Comparing the last three months with the three before them reads through the
  // noise that a single month carries.
  const recent = months.slice(-3);
  const older = months.slice(-6, -3);
  const avg = (xs: MonthStat[]) => (xs.length ? xs.reduce((t, m) => t + m.earnedUsd, 0) / xs.length : 0);
  const quarterGrowth = older.length ? ((avg(recent) - avg(older)) / avg(older)) * 100 : null;

  // Clients and people, ranked by the latest month but carrying their history.
  const clientNames = [...new Set(months.flatMap((m) => [...m.byClient.keys()]))];
  const clients = clientNames.map((name) => ({
    name,
    series: months.map((m) => m.byClient.get(name) ?? 0),
    now: latest.byClient.get(name) ?? 0,
    total: months.reduce((t, m) => t + (m.byClient.get(name) ?? 0), 0),
  })).sort((a, b) => b.now - a.now || b.total - a.total);

  const peopleNames = [...new Set(months.flatMap((m) => [...m.byPerson.keys()]))];
  const people = peopleNames.map((name) => ({
    name,
    series: months.map((m) => m.byPerson.get(name) ?? 0),
    now: latest.byPerson.get(name) ?? 0,
    total: months.reduce((t, m) => t + (m.byPerson.get(name) ?? 0), 0),
  })).sort((a, b) => b.now - a.now || b.total - a.total);

  const latestTotal = clients.reduce((t, c) => t + c.now, 0) || 1;
  const topShare = (clients[0]?.now ?? 0) / latestTotal * 100;

  return (
    <div className="overview">
      <dl className="figures inset">
        <Stat label="Earned so far" value={fmtUsd(totalUsd)} sub={`${months.length} months`} />
        <Stat label="Average month" value={fmtUsd(totalUsd / months.length)} />
        <Stat label="Best month" value={fmtUsd(best.earnedUsd)} sub={best.label} />
        <Stat label="This month vs last" value={`${growth >= 0 ? '+' : ''}${round2(growth)}%`}
          sub={previous.label} tone={growth >= 0 ? 'up' : 'down'} />
        <Stat label="Earned per hour" value={totalHours ? fmtUsd(totalUsd / totalHours) : '—'}
          sub={totalHours ? `${hoursAsText(totalHours)} worked` : 'no hours entered'} />
        <Stat label="Last 3 months vs 3 before"
          value={quarterGrowth === null ? '—' : `${quarterGrowth >= 0 ? '+' : ''}${round2(quarterGrowth)}%`}
          tone={quarterGrowth === null ? undefined : quarterGrowth >= 0 ? 'up' : 'down'} />
      </dl>

      <section className="panel span-2">
        <div className="panel-head">
          <h2>Money earned, month by month <span className="hint">in USD, with the three-month average</span></h2>
          <span className="hint">click a bar to open that month</span>
        </div>
        <RevenueChart months={months} onPick={onPick} />
      </section>

      <section className="panel span-2">
        <div className="panel-head">
          <h2>Up or down on the month before <span className="hint">as a percentage</span></h2>
        </div>
        <GrowthChart months={months} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Where the money comes from</h2>
          <span className="hint">{latest.label}</span>
        </div>
        <p className="collect-lead">
          The biggest client is <b>{round2(topShare)}%</b> of this month
          {topShare > 40 ? ' — a lot to rest on one account.' : '.'}
        </p>
        <ul className="paybars">
          {clients.filter((c) => c.now > 0).map((c) => (
            <li key={c.name}>
              <span className="pay-name">{c.name}</span>
              <span className="pay-track">
                <span className="pay-fill" style={{ width: `${(c.now / (clients[0].now || 1)) * 100}%` }} />
              </span>
              <span className="pay-fig mono">{fmtUsd(c.now)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>How much of it the team takes</h2>
          <span className="hint">team share of everything earned</span>
        </div>
        <ShareChart months={months} />
      </section>

      <section className="panel span-2">
        <div className="panel-head">
          <h2>Each client over time</h2>
          <span className="hint">USD per month · newest on the right</span>
        </div>
        <TrendTable
          rows={clients}
          months={months}
          format={fmtUsd}
          emptyText="No clients yet."
        />
      </section>

      <section className="panel span-2">
        <div className="panel-head">
          <h2>Each person over time</h2>
          <span className="hint">PKR per month · newest on the right</span>
        </div>
        <TrendTable
          rows={people}
          months={months}
          format={fmtPkr}
          emptyText="Nobody has a share yet."
        />
      </section>
    </div>
  );
}

function Stat({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: 'up' | 'down';
}) {
  return (
    <div className="figure">
      <dt>{label}</dt>
      <dd className={tone ? `tone-${tone}` : undefined}>{value}</dd>
      {sub && <small>{sub}</small>}
    </div>
  );
}

/** Bars for each month, with the three-month average drawn over them. One
 *  measure, so the average is a labelled line rather than a second colour. */
function RevenueChart({ months, onPick }: { months: MonthStat[]; onPick: (id: string) => void }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const W = 860, H = 240, padL = 56, padR = 16, padT = 16, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = Math.max(...months.map((m) => m.earnedUsd), 1);
  const ceiling = Math.ceil(max / 1000) * 1000 || 1000;
  const band = plotW / months.length;
  const barW = Math.max(6, Math.min(46, band - 12));
  const y = (v: number) => padT + plotH - (v / ceiling) * plotH;
  const x = (i: number) => padL + i * band + band / 2;

  const rolling = months.map((_, i) => {
    const slice = months.slice(Math.max(0, i - 2), i + 1);
    return slice.reduce((t, m) => t + m.earnedUsd, 0) / slice.length;
  });
  const line = rolling.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  const shown = hover ?? months.length - 1;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img"
        aria-label="Money earned each month in US dollars, with a three-month average">
        {[0, ceiling / 2, ceiling].map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="grid" />
            <text x={padL - 8} y={y(t) + 4} className="axis" textAnchor="end">${Math.round(t / 1000)}k</text>
          </g>
        ))}
        {months.map((m, i) => (
          <g key={m.period.id} className="bar-group"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            onClick={() => onPick(m.period.id)}>
            <rect x={padL + i * band} y={padT} width={band} height={plotH} className="bar-hit" />
            <rect x={x(i) - barW / 2} y={y(m.earnedUsd)} width={barW}
              height={Math.max(2, padT + plotH - y(m.earnedUsd))} rx={4}
              className={`bar${hover === i ? ' hover' : ''}${i === months.length - 1 ? ' active' : ''}`} />
            <text x={x(i)} y={H - 12} className="axis" textAnchor="middle">{m.short}</text>
            <title>{`${m.label}: ${fmtUsd(m.earnedUsd)}`}</title>
          </g>
        ))}
        <path d={line} className="avg-line" />
        <text x={x(rolling.length - 1) - barW / 2 - 8} y={y(rolling[rolling.length - 1]) - 10}
          className="axis avg-label" textAnchor="end">3-month average</text>
      </svg>
      <p className="chart-read">
        <b>{months[shown].label}</b>
        <span className="mono">{fmtUsd(months[shown].earnedUsd)}</span>
        <span className="mono muted">{hoursAsText(months[shown].hours)}</span>
      </p>
    </div>
  );
}

/** Growth is a polarity: up one way, down the other, from a zero line. */
function GrowthChart({ months }: { months: MonthStat[] }) {
  const changes = months.slice(1).map((m, i) => ({
    month: m,
    pct: months[i].earnedUsd ? ((m.earnedUsd - months[i].earnedUsd) / months[i].earnedUsd) * 100 : 0,
  }));
  const W = 860, H = 190, padL = 56, padR = 16, padT = 18, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const extent = Math.max(20, ...changes.map((c) => Math.abs(c.pct)));
  const zero = padT + plotH / 2;
  const band = plotW / changes.length;
  const barW = Math.max(6, Math.min(44, band - 12));
  const h = (pct: number) => (Math.abs(pct) / extent) * (plotH / 2);

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img"
        aria-label="Percentage change in money earned from one month to the next">
        <line x1={padL} x2={W - padR} y1={zero} y2={zero} className="grid strong" />
        <text x={padL - 8} y={zero + 4} className="axis" textAnchor="end">0%</text>
        {changes.map((c, i) => {
          const x = padL + i * band + band / 2;
          const height = Math.max(2, h(c.pct));
          const up = c.pct >= 0;
          return (
            <g key={c.month.period.id}>
              <rect x={x - barW / 2} y={up ? zero - height : zero} width={barW} height={height}
                rx={3} className={up ? 'bar-up' : 'bar-down'} />
              <text x={x} y={up ? zero - height - 6 : zero + height + 14} className="axis"
                textAnchor="middle">{`${c.pct >= 0 ? '+' : ''}${Math.round(c.pct)}%`}</text>
              <text x={x} y={H - 8} className="axis" textAnchor="middle">{c.month.short}</text>
              <title>{`${c.month.label}: ${c.pct >= 0 ? '+' : ''}${round2(c.pct)}% on the month before`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** One measure again — the team's percentage — so a single line with its average. */
function ShareChart({ months }: { months: MonthStat[] }) {
  const pts = months.map((m) => {
    const total = m.teamPkr + m.companyPkr;
    return total ? (m.teamPkr / total) * 100 : 0;
  });
  const W = 420, H = 170, padL = 40, padR = 14, padT = 16, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const y = (v: number) => padT + plotH - (v / 100) * plotH;
  const x = (i: number) => padL + (pts.length === 1 ? plotW / 2 : (i / (pts.length - 1)) * plotW);
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  const mean = pts.reduce((t, v) => t + v, 0) / pts.length;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img"
        aria-label="The team's share of everything earned, month by month, as a percentage">
        {[0, 50, 100].map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="grid" />
            <text x={padL - 8} y={y(t) + 4} className="axis" textAnchor="end">{t}%</text>
          </g>
        ))}
        <path d={line} className="series-line" />
        {pts.map((v, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(v)} r={i === pts.length - 1 ? 4.5 : 2.5} className="series-dot" />
            <title>{`${months[i].label}: ${round2(v)}% to the team`}</title>
          </g>
        ))}
      </svg>
      <p className="chart-read">
        <b>{round2(pts[pts.length - 1])}%</b>
        <span className="muted">to the team this month · {round2(mean)}% on average</span>
      </p>
    </div>
  );
}

function TrendTable({ rows, months, format, emptyText }: {
  rows: { name: string; series: number[]; now: number; total: number }[];
  months: MonthStat[];
  format: (n: number) => string;
  emptyText: string;
}) {
  if (!rows.length) return <p className="empty">{emptyText}</p>;
  const share = rows.reduce((t, r) => t + r.now, 0) || 1;
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th className="fig">{months[months.length - 1].short}</th>
            <th className="fig">Share</th>
            <th>Over {months.length} months</th>
            <th className="fig">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td className="fig mono">{r.now ? format(r.now) : '—'}</td>
              <td className="fig mono muted">{r.now ? `${round2((r.now / share) * 100)}%` : '—'}</td>
              <td><Spark series={r.series} label={r.name} months={months} format={format} /></td>
              <td className="fig mono">{format(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Spark({ series, label, months, format }: {
  series: number[]; label: string; months: MonthStat[]; format: (n: number) => string;
}) {
  const W = 132, H = 26, pad = 3;
  const max = Math.max(...series, 1);
  const x = (i: number) => pad + (series.length === 1 ? W / 2 : (i / (series.length - 1)) * (W - pad * 2));
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const line = series.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  const last = series.length - 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="spark" role="img"
      aria-label={`${label}: ${series.map((v, i) => `${months[i].short} ${format(v)}`).join(', ')}`}>
      <path d={line} className="series-line thin" />
      <circle cx={x(last)} cy={y(series[last])} r={2.5} className="series-dot" />
    </svg>
  );
}
