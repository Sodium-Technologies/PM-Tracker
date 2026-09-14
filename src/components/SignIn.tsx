import React from 'react';
import { clearUrlError, sendSignInLink, signInErrorFromUrl } from '../lib/auth';

/** Sign-in, and the two states that follow it: link sent, and signed in without
 *  access. Nothing here decides anything — the database does — so this screen
 *  only has to be clear about what happened. */
export default function SignIn({ email, noAccess, configError, onSignOut }: {
  email?: string | null;
  noAccess?: boolean;
  configError?: string;
  onSignOut?: () => void;
}) {
  const [address, setAddress] = React.useState('');
  const [sent, setSent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(() => signInErrorFromUrl() ?? '');

  React.useEffect(() => { if (error) clearUrlError(); }, [error]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return;
    setBusy(true);
    setError('');
    const { error: err } = await sendSignInLink(address);
    setBusy(false);
    if (err) setError(err);
    else setSent(true);
  };

  if (configError) {
    return (
      <Frame>
        <h1>Cannot reach sign-in</h1>
        <p>
          This site is configured to sign people in, but the service did not answer.
          Nobody can get in — including administrators — until it does.
        </p>
        <p className="signin-error">{configError}</p>
        <p className="signin-note">
          Usually one of three things: the project URL is wrong, the project is paused,
          or this site's address is missing from the redirect list in the project's
          authentication settings.
        </p>
      </Frame>
    );
  }

  if (noAccess) {
    return (
      <Frame>
        <h1>No access yet</h1>
        <p>
          You are signed in as <b>{email}</b>, but this address is not on the access
          list. Ask the account administrator to add it, then reload this page.
        </p>
        <button className="btn" onClick={onSignOut}>Sign out</button>
      </Frame>
    );
  }

  if (sent) {
    return (
      <Frame>
        <h1>Check your email</h1>
        <p>
          A sign-in link is on its way to <b>{address}</b>. Opening it on this device
          signs you in. The link works once and expires shortly.
        </p>
        <button className="btn" onClick={() => { setSent(false); setAddress(''); }}>
          Use a different address
        </button>
      </Frame>
    );
  }

  return (
    <Frame>
      <h1>PM Payroll</h1>
      <p>Sign in with the email address you were given access on.</p>
      <form onSubmit={submit} className="signin-form">
        <label htmlFor="signin-email">Email address</label>
        <input
          id="signin-email"
          type="email"
          autoComplete="email"
          required
          value={address}
          placeholder="you@company.com"
          onChange={(e) => setAddress(e.target.value)}
        />
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Email me a sign-in link'}
        </button>
      </form>
      {error && <p className="signin-error">{error}</p>}
      <p className="signin-note">
        No password to remember: the link in the email is the sign-in. Access to the
        figures is granted per address by the administrator.
      </p>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="signin">
      <div className="signin-card">{children}</div>
    </div>
  );
}
