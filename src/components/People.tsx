import React from 'react';
import { grantAccess, listAccounts, revokeAccess, type Account, type Role } from '../lib/auth';

export const ROLES: { value: Role; label: string; what: string }[] = [
  { value: 'viewer', label: 'Team', what: 'sees only their own pay and projects, in months shared with the team — nothing else' },
  { value: 'editor', label: 'Admin', what: 'edits the figures' },
  { value: 'super_admin', label: 'Super admin', what: 'edits the figures, hides months, and decides who gets in' },
];

export const roleName = (role: string | null) => ROLES.find((r) => r.value === role)?.label ?? 'No access';

/** Access list. Only a super admin can open this, and only a super admin's
 *  writes are accepted — the database enforces both. */
export default function People({ me, people, onChanged }: {
  me: string | null;
  /** everybody on the payroll, across every month — the people a team member can be */
  people: string[];
  onChanged: () => void;
}) {
  const [rows, setRows] = React.useState<Account[]>([]);
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<Role>('viewer');
  const [person, setPerson] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');

  const load = React.useCallback(async () => setRows(await listAccounts()), []);
  React.useEffect(() => { void load(); }, [load]);

  // A name somebody was linked to that has since left every month still shows,
  // or the box would quietly claim they are somebody else.
  const options = (current?: string | null) =>
    current && !people.some((p) => p.toLowerCase() === current.trim().toLowerCase())
      ? [current, ...people] : people;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (!address) return;
    setBusy(true);
    const { error } = await grantAccess(address, role, me, person);
    setBusy(false);
    setMessage(error ? error : role === 'viewer'
      ? `${address} is on the team as ${person}, and sees only ${person}'s pay.`
      : `${address} is now ${roleName(role).toLowerCase()}.`);
    if (!error) { setEmail(''); setPerson(''); await load(); onChanged(); }
  };

  const change = async (r: Account, next: Role, staffName?: string | null) => {
    const { error } = await grantAccess(r.email, next, me, staffName ?? r.staff_name);
    setMessage(error ?? (next === 'viewer'
      ? `${r.email} is on the team as ${(staffName ?? r.staff_name) || '—'}.`
      : `${r.email} is now ${roleName(next).toLowerCase()}.`));
    await load();
    onChanged();
  };

  const remove = async (address: string) => {
    if (!confirm(`Remove access for ${address}?`)) return;
    const { error } = await revokeAccess(address);
    setMessage(error ?? `${address} no longer has access.`);
    await load();
    onChanged();
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Access <span className="hint">who can open the books — one email address each</span></h2>
      </div>

      <form className="grant" onSubmit={add}>
        <input
          id="grant-email"
          type="email"
          required
          className="cell-input bordered"
          placeholder="partner@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <select className="cell-input bordered" value={role} aria-label="Access level"
          onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        {role === 'viewer' && (
          <select id="grant-person" className="cell-input bordered" value={person} required
            aria-label="Which person on the payroll" onChange={(e) => setPerson(e.target.value)}>
            <option value="">Which person?</option>
            {people.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        <button className="btn primary" type="submit" disabled={busy || (role === 'viewer' && !person)}>
          Let them in
        </button>
      </form>

      <table>
        <thead>
          <tr><th>Email</th><th>Access</th><th>Person</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isMe = me && r.email.toLowerCase() === me.toLowerCase();
            return (
              <tr key={r.email}>
                <td>
                  {r.email}
                  {isMe && <span className="sub">this is you — you cannot change your own access</span>}
                </td>
                <td>
                  <select
                    className="pill"
                    value={r.role}
                    disabled={!!isMe}
                    aria-label={`Access level for ${r.email}`}
                    onChange={(e) => {
                      const next = e.target.value as Role;
                      // Moving somebody onto the team needs a person first.
                      if (next === 'viewer' && !r.staff_name) {
                        setMessage(`Pick which person ${r.email} is, in the Person column, to put them on the team.`);
                        setRows((all) => all.map((x) => (x.email === r.email ? { ...x, role: 'viewer' } : x)));
                        return;
                      }
                      void change(r, next);
                    }}
                  >
                    {ROLES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </td>
                <td>
                  {r.role === 'viewer' ? (
                    <select className="pill" value={r.staff_name ?? ''}
                      aria-label={`Person for ${r.email}`}
                      onChange={(e) => e.target.value && change(r, 'viewer', e.target.value)}>
                      <option value="">Which person?</option>
                      {options(r.staff_name).map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  ) : <span className="hint">sees everyone</span>}
                </td>
                <td>
                  {!isMe && (
                    <button className="btn icon" aria-label={`Remove ${r.email}`}
                      onClick={() => remove(r.email)}>×</button>
                  )}
                </td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={4} className="empty">Nobody else yet.</td></tr>}
        </tbody>
      </table>

      {message && <p className="panel-note">{message}</p>}

      <dl className="settle">
        {ROLES.map((r) => (
          <div className="row" key={r.value}><dt>{r.label}</dt><dd className="hint">{r.what}</dd></div>
        ))}
      </dl>

      <p className="panel-foot">
        Anyone you add signs in with a code sent to that address. Until their address
        is on this list they see nothing at all. A team member sees their own pay only
        in months whose <b>Seen by</b> is set to <b>Team</b>. The database itself holds
        back the rest, so it isn't just hidden on the page.
      </p>
    </section>
  );
}
