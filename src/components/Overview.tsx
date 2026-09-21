import React from 'react';
import type { Period } from '../lib/types';
import { computePeriod, fmtPkr, fmtUsd, negativePkr, round2, type PeriodResult } from '../lib/calc';

/** This month alone: what came in, what is still outstanding, and who is owed
 *  what. Anything that compares months lives on the Dashboard — the one
 *  exception is the single line saying how this month sits against the last. */
export default function Overview({ periods, period, result }: {
  periods: Period[];
  period: Period;
  result: PeriodResult;
}) {
  // Only to find the month before this one, for the single comparison line.
  const months = React.useMemo(
    () => periods.filter((p) => /[A-Za-z]+\s+\d{4}/.test(p.label)),
    [periods],
  );

  const outstanding = result.accounts.filter(
    (a) => a.earnedUsd > 0 && !/received/i.test(a.account.status),
  );
  const received = result.accounts.filter((a) => /received/i.test(a.account.status));
  const outstandingUsd = round2(outstanding.reduce((t, a) => t + a.earnedUsd, 0));

  const paid = [...result.staff].sort((a, b) => b.payPkr - a.payPkr);
  const topPay = paid[0]?.payPkr || 1;

  const at = months.findIndex((p) => p.id === period.id);
  const previous = at > 0 ? months[at - 1] : undefined;
  const previousUsd = previous ? computePeriod(previous).totals.earnedUsd : 0;
  const change = previousUsd
    ? round2(((result.totals.earnedUsd - previousUsd) / previousUsd) * 100)
    : null;

  return (
    <div className="overview">
      <section className="panel">
        <div className="panel-head">
          <h2>This month</h2>
          {change !== null && (
            <span className={`delta ${change >= 0 ? 'up' : 'down'}`}>
              {change >= 0 ? '▲' : '▼'} {Math.abs(change)}% vs {previous?.label}
            </span>
          )}
        </div>
        <dl className="settle">
          <div className="row"><dt>Money earned</dt><dd>{fmtUsd(result.totals.earnedUsd)}</dd></div>
          <div className="row"><dt>The team's share</dt><dd>{fmtPkr(result.totals.freelancerPkr)}</dd></div>
          <div className="row"><dt>The company's share</dt><dd>{fmtPkr(result.totals.companyPkr)}</dd></div>
          <div className="row rule"><dt>The month is worth</dt><dd>{fmtPkr(result.ledger.transferablePkr)}</dd></div>
          <div className="row"><dt>Money received so far</dt><dd>{fmtPkr(result.ledger.receivedPkr)}</dd></div>
          {result.ledger.localWagesPkr > 0 && (
            <div className="row"><dt>You paid it yourself</dt><dd>−{fmtPkr(result.ledger.localWagesPkr)}</dd></div>
          )}
          {result.ledger.transfersPkr > 0 && (
            <div className="row"><dt>Already sent</dt><dd>−{fmtPkr(result.ledger.transfersPkr)}</dd></div>
          )}
          <div className={`row final${negativePkr(result.ledger.remainingPkr) ? ' negative' : ''}`}>
            <dt>Left to send</dt><dd>{fmtPkr(result.ledger.remainingPkr)}</dd>
          </div>
        </dl>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Who has paid us</h2>
          <span className="hint">{received.length} of {result.accounts.length} clients</span>
        </div>
        {outstanding.length > 0 ? (
          <>
            <p className="collect-lead">
              <b>{fmtUsd(outstandingUsd)}</b> has not come in yet, from {outstanding.length}{' '}
              {outstanding.length === 1 ? 'client' : 'clients'}.
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
          <p className="collect-lead">Every client has paid this month.</p>
        )}
      </section>

      <section className="panel span-2">
        <div className="panel-head">
          <h2>What each person is owed</h2>
          <span className="hint">this month, in PKR</span>
        </div>
        <ul className="paybars">
          {paid.map((s) => (
            <li key={s.staff.id}>
              <span className="pay-name">
                {s.staff.name}
                {s.staff.retained && <span className="tag-inline">you pay them</span>}
              </span>
              <span className="pay-track">
                <span className="pay-fill" style={{ width: `${Math.max(2, (s.payPkr / topPay) * 100)}%` }} />
              </span>
              <span className="pay-fig mono">{fmtPkr(s.payPkr)}</span>
            </li>
          ))}
          {!paid.length && <li className="empty">Nobody has a share yet.</li>}
        </ul>
      </section>
    </div>
  );
}
