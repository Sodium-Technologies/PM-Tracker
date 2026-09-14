import React from 'react';
import { clearUrlError, sendSignInLink, signInErrorFromUrl, signInWithCode } from '../lib/auth';

/** Sign-in, and the states that follow it: code entry, no access, and a
 *  deployment whose sign-in service cannot be reached. Nothing here decides
 *  anything — the database does — so this screen only has to be clear about
 *  what happened. */
export default function SignIn({ email, noAccess, configError, onSignOut }: {
  email?: string | null;
  noAccess?: boolean;
  configError?: string;
  onSignOut?: () => void;
}) {
  const [address, setAddress] = React.useState('');
  const [code, setCode] = React.useState('');
  const [sent, setSent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(() => signInErrorFromUrl() ?? '');

  React.useEffect(() => { if (error) clearUrlError(); }, [error]);

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return;
    setBusy(true);
    setError('');
    const { error: err } = await sendSignInLink(address);
    setBusy(false);
    if (err) setError(err);
    else setSent(true);
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError('');
    const { error: err } = await signInWithCode(address, code);
    setBusy(false);
    // On success the session arrives through onAuthStateChange and this screen
    // is replaced, so there is nothing to do here.
    if (err) setError(err);
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
          Sent to <b>{address}</b>. Click the link in that email to sign in. It works
          once, and expires shortly.
        </p>
        <details className="code-fallback">
          <summary>The email shows a six-digit code instead</summary>
          <p className="signin-note">
            Some projects send a code as well as a link. If yours does, type it here —
            it signs you in on this device, whatever the link does.
          </p>
          <form onSubmit={submitCode} className="signin-form">
            <label htmlFor="signin-code">Six-digit code</label>
            <input
              id="signin-code"
              className="code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={code}
              placeholder="123456"
              onChange={(e) => setCode(e.target.value)}
            />
            <button className="btn primary" type="submit" disabled={busy || !code.trim()}>
              {busy ? 'Checking…' : 'Sign in with code'}
            </button>
          </form>
        </details>
        {error && <p className="signin-error">{error}</p>}
        <p className="signin-note">
          Nothing arriving? A project's built-in mail service is rate limited to a few
          messages an hour. Wait a few minutes, or set up your own SMTP.
        </p>
        <button className="link" onClick={() => { setSent(false); setCode(''); setError(''); }}>
          Use a different address
        </button>
      </Frame>
    );
  }

  return (
    <Frame>
      <h1>PM Payroll</h1>
      <p>Sign in with the email address you were given access on.</p>
      <form onSubmit={request} className="signin-form">
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
        No password to remember. Access to the figures is granted per address by the
        administrator.
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
