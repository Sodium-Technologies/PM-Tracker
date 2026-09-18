import React from 'react';
import type { Period } from '../lib/types';
import { computePeriod, fmtUsd, round2 } from '../lib/calc';
import { hoursAsText } from '../lib/time';

interface MonthStat {
  period: Period;
  label: string;
  short: string;
  earnedUsd: number;
  hours: number;
  /** client name -> earned USD that month */
  byClient: Map<string, number>;
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
        hours: r.accounts.reduce((t, a) => t + a.units, 0),
        byClient: new Map(r.accounts.map((a) => [a.account.name.trim(), a.earnedUsd])),
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
      <path d={line} className="series-line" />
      <circle cx={x(last)} cy={y(series[last])} r={2.5} className="series-dot" />
    </svg>
  );
}
