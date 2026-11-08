import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { acceptAccount, acceptCookieAccount, configureRuntime, failRuntime, getSession, loadRuntimeConfig, sessionIsCurrent, subscribeSession } from './session';
const EMAIL_KEY = 'steel.account.pending-email.v1';
const MESSAGES: Record<string, string> = {
  INVALID_EMAIL: 'Enter a valid email address.', INVALID_OOB_CODE: 'This sign-in link is invalid or already used. Request a fresh link.',
  EXPIRED_OOB_CODE: 'This sign-in link expired. Request a fresh link.', TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts. Please try again later.',
  UNAUTHORIZED_DOMAIN: 'This runtime URL is not authorized for email-link sign-in. Ask the server owner to configure its Firebase domain.',
  INVALID_CONTINUE_URI: 'This runtime URL is not authorized for email-link sign-in. Ask the server owner to configure its Firebase domain.',
  MISSING_CONTINUE_URI: 'This runtime has no valid sign-in return URL. Contact the server owner.',
  OPERATION_NOT_ALLOWED: 'Email-link sign-in is not enabled for this runtime. Contact the server owner.',
};
export function readSignInReturn(location: Pick<Location, 'search' | 'pathname' | 'hash'>): string | null {
  const params = new URLSearchParams(location.search);
  return params.get('mode') === 'signIn' && params.get('oobCode') ? params.get('oobCode') : null;
}
export function removeSignInReturn() {
  const url = new URL(window.location.href);
  for (const key of ['mode', 'oobCode', 'apiKey', 'lang', 'continueUrl']) url.searchParams.delete(key);
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}
function pendingEmail() { try { return window.sessionStorage.getItem(EMAIL_KEY) ?? ''; } catch { return ''; } }
function rememberEmail(email: string | null) { try { if (email) window.sessionStorage.setItem(EMAIL_KEY, email); else window.sessionStorage.removeItem(EMAIL_KEY); } catch { /* optional convenience only */ } }
export async function accountIdentity(action: 'sendOobCode' | 'signInWithEmailLink', body: unknown) {
  const session = getSession();
  if (session.config?.mode !== 'account') throw new Error('Account sign-in is unavailable.');
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${action}?key=${encodeURIComponent(session.config.firebase.apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', redirect: 'error', body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!sessionIsCurrent(session.epoch)) throw new Error('The session changed. Start sign-in again.');
  if (!response.ok) throw new Error(MESSAGES[result.error?.message] ?? 'Unable to sign in. Request a fresh link or contact your server owner.');
  return result;
}
export async function authorizeAccount(value: { idToken: string; localId: string; email: string; expiresIn?: string }) {
  const epoch = getSession().epoch;
  if (!value.idToken || !value.localId || !value.email) throw new Error('Sign-in response was incomplete. Request a fresh link.');
  const response = await fetch('/api/workspace', { headers: { Authorization: `Bearer ${value.idToken}` }, cache: 'no-store', credentials: 'omit', redirect: 'error' });
  if (!sessionIsCurrent(epoch)) throw new Error('The session changed. Sign in again.');
  if (!response.ok) throw new Error('This account is not provisioned on this runtime, or its session expired. Contact the server owner.');
  const workspace = await response.json();
  if (!sessionIsCurrent(epoch)) throw new Error('The session changed. Sign in again.');
  if (workspace.mode !== 'account' || workspace.skillsScope !== 'account') throw new Error('The runtime did not confirm an account-private workspace. Contact the server owner.');
  acceptAccount(value);
}
function SignIn() {
  const session = useSyncExternalStore(subscribeSession, getSession);
  const [email, setEmail] = useState(pendingEmail);
  const [code, setCode] = useState(() => readSignInReturn(window.location));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(session.message ?? 'Sign in to open your private workspace.');
  useEffect(() => { if (code) removeSignInReturn(); }, [code]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) { setMessage('Enter a valid email address.'); return; }
    setBusy(true);
    try {
      if (code) {
        const result = await accountIdentity('signInWithEmailLink', { email: normalized, oobCode: code, returnSecureToken: true });
        await authorizeAccount(result);
        rememberEmail(null); setCode(null);
      } else {
        const configured = session.config?.mode === 'account' ? session.config.emailLinkContinueUrl : undefined;
        const url = new URL(configured ?? '/app/', window.location.origin);
        if (url.origin !== window.location.origin || url.pathname !== '/app/') throw new Error('The runtime sign-in return URL is invalid. Contact the server owner.');
        await accountIdentity('sendOobCode', { requestType: 'EMAIL_SIGNIN', email: normalized, continueUrl: url.toString(), canHandleCodeInApp: true });
        rememberEmail(normalized);
        setMessage('Check your email for the one-time sign-in link. Open it in this browser.');
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to sign in.'); }
    finally { setBusy(false); }
  };
  return <main className="account-gate">
    <h1>Steel AI</h1><h2>{code ? 'Finish signing in' : 'Open your workspace'}</h2>
    <p>This runtime keeps each provisioned account’s skills, workflows and run history separate.</p>
    <form onSubmit={(event) => void submit(event)}>
      <label htmlFor="account-email">Email address</label>
      <input id="account-email" type="email" autoComplete="email" required value={email} disabled={busy} onChange={(event) => setEmail(event.target.value)} />
      <button className="btn btn-primary" disabled={busy} type="submit">{busy ? 'Working…' : code ? 'Confirm email and sign in' : 'Send sign-in link'}</button>
    </form>
    <p role="status">{message}</p>
    {code && <button className="btn" disabled={busy} onClick={() => { setCode(null); setMessage('Request a fresh sign-in link.'); }}>Request a new link</button>}
    <p>Use the email authorized by your server owner. A website connection-test key cannot sign in to this runtime.</p>
  </main>;
}

export function AccountGate({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(subscribeSession, getSession);
  const [attempt, setAttempt] = useState(0);
  const [verified, setVerified] = useState(false);
  useEffect(() => {
    setVerified(false);
    let cancelled = false;
    const controller = new AbortController();
    void loadRuntimeConfig(controller.signal).then(async (config) => {
      if (cancelled) return;
      configureRuntime(config);
      if (config.mode === 'account' && config.authMethod === 'session-cookie') {
        const epoch = getSession().epoch;
        const response = await fetch('/api/session', {credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
        if (response.status !== 401) {
          if (!response.ok) throw new Error('Unable to verify website session');
          const value = await response.json();
          if (!value.access?.runtimePreviewEligible) throw new Error('This account has waitlist access. Runtime preview is available only to the owner.');
          const workspaceResponse = await fetch('/api/workspace', {credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
          if (!workspaceResponse.ok) throw new Error('Runtime workspace unavailable');
          const workspace = await workspaceResponse.json();
          if (cancelled || !sessionIsCurrent(epoch)) return;
          if (workspace.mode !== 'account' || workspace.skillsScope !== 'account') throw new Error('Private workspace not confirmed');
          acceptCookieAccount(value);
        }
      }
      if (!cancelled) setVerified(true);
    }).catch((error) => { if (!cancelled) { failRuntime(error instanceof Error && error.message.startsWith('This account has waitlist access.') ? error.message : undefined); setVerified(true); } });
    return () => { cancelled = true; controller.abort(); };
  }, [attempt]);
  if (!verified || session.mode === 'boot') return <main className="account-gate"><h1>Steel AI</h1><p role="status">Checking this runtime…</p></main>;
  if (session.mode === 'error') return <main className="account-gate"><h1>Steel AI</h1><p role="alert">{session.message}</p><button className="btn" onClick={() => setAttempt((a) => a + 1)}>Retry runtime connection</button></main>;
  if (session.mode === 'account' && !session.idToken && !session.cookieAuthenticated && session.config?.mode === 'account' && session.config.authMethod === 'session-cookie') return <main className="account-gate"><h1>Steel AI</h1><h2>Sign in on the website</h2><p role="status">{session.message ?? 'Use your Steel AI website account to open this workspace.'}</p><a className="btn btn-primary" href="/signin.html">Go to website sign-in</a><p>Your account must be enabled for the runtime preview. Waitlist accounts retain private draft storage and connection testing.</p></main>;
  if (session.mode === 'account' && !session.idToken && !session.cookieAuthenticated) return <SignIn key={session.epoch} />;
  return <div className="account-session" key={session.epoch}>{children}</div>;
}
