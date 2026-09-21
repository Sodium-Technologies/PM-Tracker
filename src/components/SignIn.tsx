import React from 'react';
import { clearUrlError, sendSignInEmail, signInErrorFromUrl, signInWithCode } from '../lib/auth';
import Mark from './Mark';

/** Sign-in, and the states that follow it: code entry, no access, and a
 *  deployment whose sign-in service cannot be reached. Nothing here decides
 *  anything — the database does — so this screen only has to be clear about
 *  what happened.
 *
 *  One way in: the six-digit code from the email, typed into the window that
 *  asked for it. A link was the other half of this screen and is gone. It
 *  opened a second copy of the app to do the exchange, it could not sign in a
 *  home-screen app at all, and it does not survive a mail scanner opening it
 *  first. The project's email template sends a code and no link. */
export default function SignIn({ email, noAccess, configError, onSignOut }: {
  email?: string | null;
  noAccess?: boolean;
  configError?: string;
  onSignOut?: () => void;
}) {
  const [address, setAddress] = React.useState('');
  const [code, setCode] = React.useState('');
  const codeRef = React.useRef<HTMLInputElement>(null);
  const [sent, setSent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(() => signInErrorFromUrl() ?? '');

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

  /** Read the box rather than trusting React's copy of it. A paste on iOS that
   *  does not fire a change event leaves the state empty while the field plainly
   *  has a code in it — and a disabled button then does nothing at all, which is
   *  the worst thing a sign-in screen can do. */
  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const typed = (codeRef.current?.value || code).trim();
    if (!typed) {
      setError('Type the six-digit code from the email first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      // On success the session arrives through onAuthStateChange and this screen
      // is replaced, so there is nothing to do here.
      const { error: err } = await signInWithCode(address, typed);
      if (err) setError(err);
    } catch (thrown) {
      setError(`Could not check that code: ${(thrown as Error).message ?? String(thrown)}`);
    } finally {
      setBusy(false);
    }
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
        </p>

        <form onSubmit={submitCode} className="signin-form">
          <label htmlFor="signin-code">Six-digit code</label>
          <input
            ref={codeRef}
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
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
        </form>

        {error && <p className="signin-error">{error}</p>}
        <p className="signin-note">
          The code works once and expires shortly. It signs you in on this device,
          in this window — there is nothing to click and nothing else to open.
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
          {busy ? 'Sending…' : 'Email me a code'}
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
