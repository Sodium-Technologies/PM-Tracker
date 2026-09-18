import React from 'react';
import { grantAccess, listAccounts, revokeAccess, type Account, type Role } from '../lib/auth';

const ROLES: { value: Role; label: string; what: string }[] = [
  { value: 'viewer', label: 'Can look', what: 'sees every figure, changes nothing' },
  { value: 'editor', label: 'Can change', what: 'edits the figures' },
  { value: 'super_admin', label: 'Runs it', what: 'edits the figures and decides who gets in' },
];

/** Access list. Only an administrator can open this, and only an administrator's
 *  writes are accepted — the database enforces both. */
export default function People({ me, onChanged }: { me: string | null; onChanged: () => void }) {
  const [rows, setRows] = React.useState<Account[]>([]);
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<Role>('viewer');
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');

  const load = React.useCallback(async () => setRows(await listAccounts()), []);
  React.useEffect(() => { void load(); }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (!address) return;
    setBusy(true);
    const { error } = await grantAccess(address, role, me);
    setBusy(false);
    setMessage(error ? error : `${address} can now ${role === 'viewer' ? 'view' : 'edit'}.`);
    if (!error) { setEmail(''); await load(); onChanged(); }
  };

  const change = async (address: string, next: Role) => {
    const { error } = await grantAccess(address, next, me);
    setMessage(error ?? `${address} is now ${ROLES.find((r) => r.value === next)?.label.toLowerCase()}.`);
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
        <h2>Who can open this <span className="hint">one email address each</span></h2>
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
        <button className="btn primary" type="submit" disabled={busy}>Let them in</button>
      </form>

      <table>
        <thead>
          <tr><th>Email</th><th>Access</th><th /></tr>
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
                    onChange={(e) => change(r.email, e.target.value as Role)}
                  >
                    {ROLES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
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
          {!rows.length && <tr><td colSpan={3} className="empty">Nobody else yet.</td></tr>}
        </tbody>
      </table>

      {message && <p className="panel-note">{message}</p>}

      <dl className="settle">
        {ROLES.map((r) => (
          <div className="row" key={r.value}><dt>{r.label}</dt><dd className="hint">{r.what}</dd></div>
        ))}
      </dl>

      <p className="panel-foot">
        Anyone you add signs in with a link sent to that address. Until their address
        is on this list they see nothing at all — the figures are held back by the
        database itself, not just hidden on the page.
      </p>
    </section>
  );
}
