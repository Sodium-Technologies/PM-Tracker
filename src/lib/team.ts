import type { Period } from './types';
import { computePeriod } from './calc';
import { supabase } from './supabase';
import { sortPeriods } from './cloud';

/** What a team member is shown for one month: their own pay and the projects it
 *  came from. Nothing else leaves the books — no client's rate, no revenue, no
 *  company share, nobody else's pay. */
export interface TeamSummary {
  label: string;
  name: string;
  usdToPkr: number;
  projects: { name: string; hours: number; sharePct: number; earnedPkr: number; earnedUsd: number }[];
  /** from the projects, before any adjustment */
  sharePkr: number;
  adjustmentPkr: number;
  payPkr: number;
  payUsd: number;
  /** already taken this month */
  takenPkr: number;
  stillOwedPkr: number;
}

/** A person is matched by name, the way the rest of the app matches people
 *  across months. */
export const memberKey = (name: string) => name.trim().toLowerCase();

export function summariesFor(period: Period): { member: string; summary: TeamSummary }[] {
  const r = computePeriod(period);
  const rate = Number(period.usdToPkr) || 0;
  return r.staff
    .filter((s) => memberKey(s.staff.name))
    .map((s) => ({
      member: memberKey(s.staff.name),
      summary: {
        label: period.label,
        name: s.staff.name.trim(),
        usdToPkr: rate,
        projects: r.accounts
          .filter((a) => (Number(s.staff.shares[a.account.id]) || 0) > 0)
          .map((a) => {
            const earnedPkr = s.byAccount[a.account.id] ?? 0;
            return {
              name: a.account.name.trim(),
              hours: a.units,
              sharePct: (Number(s.staff.shares[a.account.id]) || 0) * 100,
              earnedPkr,
              earnedUsd: rate ? earnedPkr / rate : 0,
            };
          }),
        sharePkr: s.sharePkr,
        adjustmentPkr: Number(s.staff.adjustmentPkr) || 0,
        payPkr: s.payPkr,
        payUsd: s.payUsd,
        takenPkr: Math.max(0, Number(s.staff.advancePkr) || 0),
        stillOwedPkr: s.stillOwedPkr,
      },
    }));
}

/** True when the project has not been given the team table yet. Publishing is a
 *  courtesy to the team, never a reason to report the books as unsaved. */
const missingTable = (message?: string) => !!message && /team_pay/i.test(message);

/** Write each person's summary for these months, and drop the ones for people
 *  no longer on them. Returns an error only for something worth telling. */
export async function publishTeamPay(periods: Period[]): Promise<{ error?: string }> {
  if (!supabase) return {};
  for (const p of periods) {
    const rows = summariesFor(p);
    // Two rows with one name would collide on the key; the later one wins.
    const byMember = new Map(rows.map((x) => [x.member, x]));
    if (byMember.size) {
      const { error } = await supabase.from('team_pay').upsert(
        [...byMember.values()].map((x) => ({
          period_id: p.id, member: x.member, label: p.label, summary: x.summary,
        })),
        { onConflict: 'period_id,member' },
      );
      if (error) return missingTable(error.message) ? {} : { error: error.message };
    }
    let gone = supabase.from('team_pay').delete().eq('period_id', p.id);
    if (byMember.size) {
      const list = [...byMember.keys()].map((m) => `"${m.replace(/(["\\])/g, '\\$1')}"`).join(',');
      gone = gone.not('member', 'in', `(${list})`);
    }
    const { error } = await gone;
    if (error) return missingTable(error.message) ? {} : { error: error.message };
  }
  return {};
}

/** A team member's own months, oldest first. The database returns nothing but
 *  their own rows, in months shared with the team. */
export async function fetchTeamPay(): Promise<{ months: TeamSummary[]; error?: string }> {
  if (!supabase) return { months: [] };
  const { data, error } = await supabase.from('team_pay').select('period_id,label,summary');
  if (error) return { months: [], error: error.message };
  const rows = (data as { period_id: string; label: string; summary: TeamSummary }[]) ?? [];
  // sortPeriods only reads the label.
  const ordered = sortPeriods(rows.map((r) => ({ id: r.period_id, label: r.label } as unknown as Period)));
  const byId = new Map(rows.map((r) => [r.period_id, r]));
  return { months: ordered.map((p) => ({ ...byId.get(p.id)!.summary, label: byId.get(p.id)!.label })) };
}
