import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import { workspaceApiPath } from './session';
import {
  acceptAccount,
  acceptCookieAccount,
  configureRuntime,
  failRuntime,
  getSession,
  loadRuntimeConfig,
  sessionIsCurrent,
  subscribeSession,
} from './session';
const EMAIL_KEY = 'steel.account.pending-email.v1';
const CLOUD_SIGN_IN = 'https://steelai.dev/signin';

function AccountFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="account-gate">
      <div className="account-card">
        <div className="account-brand">
          <span className="shell-mark" aria-hidden="true"><span /></span>
          {import.meta.env.VITE_STEEL_CLOUD === '1' ? 'Steel Cloud' : 'Steel AI'}
        </div>
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}
const HANDOFF_KEY = 'steel.account.pending-handoff.v1';
function handoffChannel(id: string) {
  try {
    return new BroadcastChannel(`steel.account.sign-in.${id}`);
  } catch {
    return null;
  }
}
function pendingHandoff(id?: string | null) {
  try {
    if (id === null) {
      window.localStorage.removeItem(HANDOFF_KEY);
    } else if (id) {
      window.localStorage.setItem(HANDOFF_KEY, id);
    } else {
      return window.localStorage.getItem(HANDOFF_KEY);
    }
  } catch {
    /* Cross-tab sign-in is optional when browser storage is blocked. */
  }
  return null;
}
const MESSAGES: Record<string, string> = {
  INVALID_EMAIL: 'Enter a valid email address.',
  INVALID_OOB_CODE:
    'This sign-in link is invalid or already used. Request a fresh link.',
  EXPIRED_OOB_CODE: 'This sign-in link expired. Request a fresh link.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts. Please try again later.',
  UNAUTHORIZED_DOMAIN:
    'This runtime URL is not authorized for email-link sign-in. Ask the server owner to configure its Firebase domain.',
  INVALID_CONTINUE_URI:
    'This runtime URL is not authorized for email-link sign-in. Ask the server owner to configure its Firebase domain.',
  MISSING_CONTINUE_URI:
    'This runtime has no valid sign-in return URL. Contact the server owner.',
  OPERATION_NOT_ALLOWED:
    'Email-link sign-in is not enabled for this runtime. Contact the server owner.',
};
export function readSignInReturn(
  location: Pick<Location, 'search' | 'pathname' | 'hash'>,
): string | null {
  const params = new URLSearchParams(location.search);
  return params.get('mode') === 'signIn' && params.get('oobCode')
    ? params.get('oobCode')
    : null;
}
export function removeSignInReturn() {
  const url = new URL(window.location.href);
  for (const key of ['mode', 'oobCode', 'apiKey', 'lang', 'continueUrl']) {
    url.searchParams.delete(key);
  }
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}
function pendingEmail() {
  for (const storage of ['localStorage', 'sessionStorage'] as const) {
    try {
      const email = window[storage].getItem(EMAIL_KEY);
      if (email) {
        return email;
      }
    } catch {
      /* Storage can be blocked by browser settings. */
    }
  }
  return '';
}
function rememberEmail(email: string | null) {
  for (const storage of ['localStorage', 'sessionStorage'] as const) {
    try {
      if (email) {
        window[storage].setItem(EMAIL_KEY, email);
      } else {
        window[storage].removeItem(EMAIL_KEY);
      }
    } catch {
      /* optional convenience only */
    }
  }
}
export async function accountIdentity(
  action: 'sendOobCode' | 'signInWithEmailLink',
  body: unknown,
) {
  const session = getSession();
  if (session.config?.mode !== 'account') {
    throw new Error('Account sign-in is unavailable.');
  }
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:${action}?key=${encodeURIComponent(session.config.firebase.apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      body: JSON.stringify(body),
    },
  );
  const result = await response.json();
  if (!sessionIsCurrent(session.epoch)) {
    throw new Error('The session changed. Start sign-in again.');
  }
  if (!response.ok) {
    throw new Error(
      MESSAGES[result.error?.message] ??
        'Unable to sign in. Request a fresh link or contact your server owner.',
    );
  }
  return result;
}
export async function authorizeAccount(value: {
  idToken: string;
  localId: string;
  email: string;
  expiresIn?: string;
}) {
  const epoch = getSession().epoch;
  if (!value.idToken || !value.localId || !value.email) {
    throw new Error('Sign-in response was incomplete. Request a fresh link.');
  }
  const config = getSession().config;
  if (config?.mode === 'account' && config.authMethod === 'cloud-session') {
    const established = await fetch(workspaceApiPath('/api/session'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${value.idToken}`, 'X-Steel-CSRF': '1' },
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    });
    if (!established.ok) throw new Error('Unable to open this private workspace. Check that your email is approved.');
    const account = await established.json();
    if (!sessionIsCurrent(epoch) || account.uid !== value.localId || account.email !== value.email) {
      throw new Error('The session changed. Sign in again.');
    }
    acceptCookieAccount(account);
    return;
  }
  const response = await fetch(workspaceApiPath('/api/workspace'), {
    headers: { Authorization: `Bearer ${value.idToken}` },
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
  });
  if (!sessionIsCurrent(epoch)) {
    throw new Error('The session changed. Sign in again.');
  }
  if (!response.ok) {
    throw new Error(
      'This account is not provisioned on this runtime, or its session expired. Contact the server owner.',
    );
  }
  const workspace = await response.json();
  if (!sessionIsCurrent(epoch)) {
    throw new Error('The session changed. Sign in again.');
  }
  if (workspace.mode !== 'account' || workspace.skillsScope !== 'account') {
    throw new Error(
      'The runtime did not confirm an account-private workspace. Contact the server owner.',
    );
  }
  acceptAccount(value);
}
function SignIn() {
  const session = useSyncExternalStore(subscribeSession, getSession);
  const [code, setCode] = useState(() => readSignInReturn(window.location));
  const [savedEmail] = useState(() => (code ? pendingEmail() : ''));
  const [handoffId] = useState(() => (savedEmail ? pendingHandoff() : null));
  const [email, setEmail] = useState(savedEmail);
  const [busy, setBusy] = useState(false);
  const autoAttempted = useRef(false);
  const handoff = useRef<BroadcastChannel | null>(null);
  useEffect(() => () => handoff.current?.close(), []);
  const [message, setMessage] = useState(
    session.message ?? 'Sign in to open your private workspace.',
  );
  const finishSignIn = useCallback(async (email: string, oobCode: string) => {
    setBusy(true);
    setMessage('Signing in…');
    try {
      const result = await accountIdentity('signInWithEmailLink', {
        email,
        oobCode,
        returnSecureToken: true,
      });
      await authorizeAccount(result);
      if (handoffId && result.email.toLowerCase() === savedEmail) {
        const channel = handoffChannel(handoffId);
        try {
          const { idToken, localId, email, expiresIn } = result;
          channel?.postMessage({ idToken, localId, email, expiresIn });
        } finally {
          channel?.close();
        }
      }
      if (pendingHandoff() === handoffId) {
        pendingHandoff(null);
        rememberEmail(null);
      }
      setCode(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }, [handoffId, savedEmail]);
  useEffect(() => {
    if (code) {
      removeSignInReturn();
      if (savedEmail && !autoAttempted.current) {
        autoAttempted.current = true;
        void finishSignIn(savedEmail, code);
      }
    }
  }, [code, finishSignIn, savedEmail]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setMessage('Enter a valid email address.');
      return;
    }
    if (code) {
      await finishSignIn(normalized, code);
      return;
    }
    setBusy(true);
    try {
      const configured =
        session.config?.mode === 'account'
          ? session.config.emailLinkContinueUrl
          : undefined;
      const url = new URL(configured ?? '/app/', window.location.origin);
      if (url.origin !== window.location.origin || url.pathname !== '/app/') {
        throw new Error(
          'The runtime sign-in return URL is invalid. Contact the server owner.',
        );
      }
      if (import.meta.env.VITE_STEEL_CLOUD === '1') url.hash = window.location.hash;
      await accountIdentity('sendOobCode', {
        requestType: 'EMAIL_SIGNIN',
        email: normalized,
        continueUrl: url.toString(),
        canHandleCodeInApp: true,
      });
      handoff.current?.close();
      const id = crypto.randomUUID?.();
      const channel = id ? handoffChannel(id) : null;
      handoff.current = channel;
      if (channel && id) {
        const epoch = getSession().epoch;
        channel.onmessage = ({ data }) => {
          if (
            !sessionIsCurrent(epoch) ||
            typeof data?.email !== 'string' ||
            data.email.toLowerCase() !== normalized
          ) {
            return;
          }
          channel.close();
          setBusy(true);
          setMessage('Signing in…');
          void authorizeAccount(data)
            .catch((error) => {
              setMessage(error instanceof Error ? error.message : 'Unable to sign in.');
            })
            .finally(() => setBusy(false));
        };
        pendingHandoff(id);
      } else {
        pendingHandoff(null);
      }
      rememberEmail(normalized);
      setMessage(
        'Check your email for the one-time sign-in link. Open it in this browser.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <AccountFrame title={code ? 'Finish signing in' : 'Open your workspace'}>
      {import.meta.env.VITE_STEEL_ENVIRONMENT === 'staging' && (
        <p>
          Test environment. Workspaces are temporary and may reset when the
          server restarts.
        </p>
      )}
      <form hidden={Boolean(code && busy)} onSubmit={(event) => void submit(event)}>
        <label htmlFor="account-email">Email address</label>
        <input
          id="account-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          disabled={busy}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button className="btn btn-primary" disabled={busy} type="submit">
          {busy
            ? 'Working…'
            : code
              ? 'Confirm email and sign in'
              : 'Send sign-in link'}
        </button>
      </form>
      <p role="status">{message}</p>
      {code && !busy && (
        <button
          className="btn"
          disabled={busy}
          onClick={() => {
            setCode(null);
            setMessage('Request a fresh sign-in link.');
          }}
        >
          Request a new link
        </button>
      )}
      <p>
        Use the email your server owner approved.
      </p>
    </AccountFrame>
  );
}

export function AccountGate({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(subscribeSession, getSession);
  const [attempt, setAttempt] = useState(0);
  const [verified, setVerified] = useState(false);
  const [email, setEmail] = useState('');
  const [emailStatus, setEmailStatus] = useState('');
  const [sendingLink, setSendingLink] = useState(false);
  const [returnCode] = useState(() => readSignInReturn(window.location));
  const startup = useRef<Promise<Response> | null>(null);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const waiting = verified && session.config?.mode === 'account' &&
    session.config.authMethod === 'session-cookie' && !session.cookieAuthenticated;
  useEffect(() => {
    if (!waiting || typeof BroadcastChannel !== 'function') return;
    const channel = handoffChannel('cookie-ready');
    if (!channel) return;
    channel.onmessage = retry;
    return () => channel.close();
  }, [retry, waiting]);
  async function requestLink(event: React.FormEvent) {
    event.preventDefault();
    setSendingLink(true);
    try {
      const response = await fetch(workspaceApiPath('/api/session/email/request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Steel-CSRF': '1' },
        body: JSON.stringify({ email }),
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Unable to send the link. Try again or use website sign-in.');
      setEmail('');
      setEmailStatus('Check your email. Open the link in this browser.');
    } catch (error) {
      setEmailStatus(error instanceof Error ? error.message : 'Unable to send the link.');
    } finally {
      setSendingLink(false);
    }
  }
  useEffect(() => {
    setVerified(false);
    let cancelled = false;
    const controller = new AbortController();
    void loadRuntimeConfig(controller.signal)
      .then(async (config) => {
        if (cancelled) {
          return;
        }
        configureRuntime(config);
        if (config.mode === 'account' && config.authMethod === 'cloud-session' && !(attempt === 0 && returnCode)) {
          const epoch = getSession().epoch;
          const restored = await fetch(workspaceApiPath('/api/session'), {
            credentials: 'same-origin',
            cache: 'no-store',
            redirect: 'error',
            signal: controller.signal,
          });
          if (restored.ok) {
            const account = await restored.json();
            if (!cancelled && sessionIsCurrent(epoch)) acceptCookieAccount(account);
          } else if (restored.status !== 401 && restored.status !== 403) {
            throw new Error('Unable to restore your workspace session.');
          }
        }
        if (
          config.mode === 'account' &&
          config.authMethod === 'session-cookie'
        ) {
          const epoch = getSession().epoch;
          if (attempt === 0 && returnCode) {
            removeSignInReturn();
            startup.current ??= fetch(workspaceApiPath('/api/session/email/complete'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Steel-CSRF': '1' },
              body: JSON.stringify({ code: returnCode }),
              credentials: 'same-origin',
              redirect: 'error',
              cache: 'no-store',
            });
            const completed = await startup.current;
            if (cancelled) return;
            if (!completed.ok) {
              setEmailStatus('Unable to finish sign-in. Request a new link from this browser.');
              setVerified(true);
              return;
            }
            const channel = handoffChannel('cookie-ready');
            channel?.postMessage(null);
            channel?.close();
          }
          const response = await fetch(workspaceApiPath('/api/session'), {
            headers: { 'X-Steel-Session-View': 'workspace' },
            credentials: 'same-origin',
            cache: 'no-store',
            redirect: 'error',
            signal: controller.signal,
          });
          if (response.status !== 401) {
            if (!response.ok) {
              throw new Error('Unable to verify website session');
            }
            const value = await response.json();
            if (!value.access?.runtimePreviewEligible) {
              throw new Error(
                'This account has waitlist access. Runtime preview is available only to the owner.',
              );
            }
            const workspaceResponse = await fetch(workspaceApiPath('/api/workspace'), {
              credentials: 'same-origin',
              cache: 'no-store',
              redirect: 'error',
              signal: controller.signal,
            });
            if (!workspaceResponse.ok) {
              throw new Error('Runtime workspace unavailable');
            }
            const workspace = await workspaceResponse.json();
            if (cancelled || !sessionIsCurrent(epoch)) {
              return;
            }
            if (
              workspace.mode !== 'account' ||
              workspace.skillsScope !== 'account'
            ) {
              throw new Error('Private workspace not confirmed');
            }
            acceptCookieAccount(value);
          }
        }
        if (!cancelled) {
          setVerified(true);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          failRuntime(
            error instanceof Error &&
              error.message.startsWith('This account has waitlist access.')
              ? error.message
              : undefined,
          );
          setVerified(true);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [attempt, returnCode]);
  if (!verified || session.mode === 'boot') {
    return (
      <AccountFrame title="Opening your workspace">
        <p role="status">Checking your connection…</p>
      </AccountFrame>
    );
  }
  if (session.mode === 'error') {
    return (
      <AccountFrame title="Workspace unavailable">
        <p role="alert">{session.message}</p>
        <button className="btn" onClick={() => setAttempt((a) => a + 1)}>
          Try again
        </button>
        <a className="account-link" href={CLOUD_SIGN_IN}>Sign in to Steel AI Cloud</a>
      </AccountFrame>
    );
  }
  if (
    session.mode === 'account' &&
    !session.idToken &&
    !session.cookieAuthenticated &&
    session.config?.mode === 'account' &&
    session.config.authMethod === 'session-cookie'
  ) {
    return (
      <AccountFrame title="Open your workspace">
        <p>Sign in with your email. You’ll get a link to open in this browser.</p>
        {session.message && <p className="account-message" role="status">{session.message}</p>}
        <a className="btn btn-primary account-primary" href={CLOUD_SIGN_IN}>
          Sign in to Steel AI Cloud
        </a>
        {emailStatus && <p className="account-message" role="status">{emailStatus}</p>}
        <details className="account-options">
          <summary>Sign in to this workspace directly</summary>
          <form onSubmit={(event) => void requestLink(event)}>
            <label htmlFor="workspace-email">Email address</label>
            <input id="workspace-email" type="email" autoComplete="email"
              required value={email} onChange={(event) => setEmail(event.target.value)} />
            <button className="btn" type="submit" disabled={sendingLink}>
              {sendingLink ? 'Sending…' : 'Send sign-in link'}
            </button>
          </form>
        </details>
        <p className="account-note">Workflow Creator preview requires account approval.</p>
      </AccountFrame>
    );
  }
  if (
    session.mode === 'account' &&
    !session.idToken &&
    !session.cookieAuthenticated
  ) {
    return <SignIn key={session.epoch} />;
  }
  return (
    <div className="account-session" key={session.epoch}>
      {children}
    </div>
  );
}
