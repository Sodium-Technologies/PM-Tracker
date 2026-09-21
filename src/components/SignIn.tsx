import React from 'react';
import { clearUrlError, isInstalledApp, sendSignInEmail, signInErrorFromUrl, signInWithCode } from '../lib/auth';
import Mark from './Mark';

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
  // An installed app cannot be signed in by a link at all, so it is not offered
  // one. In a browser the link still works; the code is simply the calmer path,
  // because it finishes in this window instead of opening another copy.
  const installed = React.useMemo(isInstalledApp, []);

  React.useEffect(() => { if (error) clearUrlError(); }, [error]);

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return;
    setBusy(true);
    setError('');
    const { error: err } = await sendSignInEmail(address);
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
          Sent to <b>{address}</b>. Type the six-digit code from that email below.
          {!installed && ' The email has a link too, but the code signs you in right here, without opening another window.'}
        </p>
        <form onSubmit={submitCode} className="signin-form">
          <label htmlFor="signin-code">Six-digit code</label>
          <input
            id="signin-code"
            className="code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            autoFocus
            value={code}
            placeholder="123456"
            onChange={(e) => setCode(e.target.value)}
          />
          <button className="btn primary" type="submit" disabled={busy || !code.trim()}>
            {busy ? 'Checking…' : 'Sign in with code'}
          </button>
        </form>
        {error && <p className="signin-error">{error}</p>}
        <p className="signin-note">
          No code in the email, only a link? The email template needs to include the
          token — see "Sharing it with other people" in the README.
          {installed && ' On a home-screen app the link cannot work: it opens in Safari, which is a different app with its own sign-in.'}
        </p>
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
      <h1 className="signin-brand"><Mark className="mark lg" />CKO PM Payroll</h1>
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
          {busy ? 'Sending…' : 'Email me a sign-in code'}
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
