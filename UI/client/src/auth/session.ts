// Bearer credentials never enter Redux, browser storage, URLs, logs or recovery files.
// Hosted sessions use a server-issued HttpOnly cookie that JavaScript cannot read.
export type FirebaseConfig = { apiKey: string; projectId: string; authDomain: string };
export type RuntimeConfig = { mode: 'local' } | { mode: 'account'; firebase: FirebaseConfig; emailLinkContinueUrl?: string; authMethod?: 'session-cookie' };
export type ShadowAuthSession = {
  authenticated: boolean; firebase_uid: string | null; email: string | null; display_name: string | null;
};
export type SessionState = {
  mode: 'boot' | 'error' | 'local' | 'account'; epoch: number;
  config?: RuntimeConfig; uid?: string; email?: string; idToken?: string; cookieAuthenticated?: boolean; message?: string;
  auth?: ShadowAuthSession;
};
export function shadowAuthSession(value: {uid?: string; firebase_uid?: string | null; email?: string | null; display_name?: string | null; authenticated?: boolean} | null | undefined): ShadowAuthSession {
  const firebase_uid = typeof value?.firebase_uid === 'string' && value.firebase_uid ? value.firebase_uid : (typeof value?.uid === 'string' && value.uid ? value.uid : null);
  const email = typeof value?.email === 'string' && value.email ? value.email : null;
  const authenticated = value?.authenticated === true || Boolean(firebase_uid && email);
  if (!authenticated || !firebase_uid || !email) return {authenticated: false, firebase_uid: null, email: null, display_name: null};
  return {authenticated: true, firebase_uid, email, display_name: typeof value?.display_name === 'string' && value.display_name ? value.display_name : email};
}
let state: SessionState = { mode: 'boot', epoch: 0 };
const listeners = new Set<() => void>();
const boundaryListeners = new Set<() => void>();
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
export const getSession = () => state;
export function subscribeSession(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function onSessionBoundary(listener: () => void) { boundaryListeners.add(listener); return () => { boundaryListeners.delete(listener); }; }
function transition(next: Omit<SessionState, 'epoch'>) {
  if (expiryTimer) clearTimeout(expiryTimer);
  state = { ...next, epoch: state.epoch + 1 };
  // Drop caches and editors synchronously before consumers render this identity.
  for (const listener of boundaryListeners) listener();
  for (const listener of listeners) listener();
}
export function configureRuntime(config: RuntimeConfig) { transition({ mode: config.mode, config }); }
export function failRuntime(message = 'Unable to verify this runtime. Retry before opening a workspace.') { transition({ mode: 'error', message }); }
export function acceptAccount(value: { idToken: string; localId: string; email: string; expiresIn?: string }) {
  if (state.mode !== 'account' || state.config?.mode !== 'account') throw new Error('Account sign-in is unavailable on this runtime.');
  if (!value.idToken || !value.localId || !value.email) throw new Error('Sign-in response was incomplete. Request a fresh link.');
  const config = state.config;
  transition({ mode: 'account', config, idToken: value.idToken, uid: value.localId, email: value.email, auth: shadowAuthSession({authenticated: true, firebase_uid: value.localId, email: value.email, display_name: value.email}) });
  const seconds = Math.min(86400, Math.max(1, Number(value.expiresIn ?? '3600') || 3600));
  expiryTimer = setTimeout(() => endAccount('Your session expired. Sign in again to open your workspace.'), seconds * 1000);
}
export function acceptCookieAccount(value: {uid: string; email: string; expiresAt: number}) {
  if (state.config?.mode !== 'account' || state.config.authMethod !== 'session-cookie') throw new Error('Website session is unavailable on this runtime.');
  if (!value.uid || !value.email || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) throw new Error('Your website session expired. Sign in again.');
  const auth = shadowAuthSession(value);
  transition({mode:'account', config:state.config, uid:value.uid, email:value.email, cookieAuthenticated:true, auth});
  expiryTimer = setTimeout(() => endAccount('Your website session expired. Sign in again.'), Math.min(value.expiresAt - Date.now(), 86400000));
}
export async function signOutAccount() {
  if (state.config?.mode === 'account' && state.config.authMethod === 'session-cookie') {
    // Clear local state immediately, including when the server cannot be reached.
    endAccount('Signing out...');
    try {
      const response = await fetch('/api/session', {method:'DELETE',credentials:'same-origin',headers:{'X-Steel-CSRF':'1'},redirect:'error',cache:'no-store'});
      if (!response.ok) throw new Error('Sign-out could not be confirmed. Close this tab and retry on the website.');
      endAccount();
    } catch { endAccount('Server sign-out could not be confirmed. Retry sign-out on the website before sharing this browser.'); }
  } else endAccount();
}
export function endAccount(message = 'Signed out. Your saved work remains on the server.') {
  if (state.mode !== 'account') return;
  transition({ mode: 'account', config: state.config, message });
}
export function sessionIsCurrent(epoch: number) { return state.epoch === epoch; }

export function parseRuntimeConfig(value: unknown): RuntimeConfig {
  if (!value || typeof value !== 'object') throw new Error('Runtime configuration unavailable');
  const v = value as Record<string, any>;
  if (v.mode === 'local') return { mode: 'local' };
  if (v.mode !== 'account' || !v.firebase || typeof v.firebase.apiKey !== 'string' || !v.firebase.apiKey || typeof v.firebase.projectId !== 'string' || !v.firebase.projectId || typeof v.firebase.authDomain !== 'string' || !v.firebase.authDomain) throw new Error('Runtime configuration unavailable');
  if (v.authMethod !== undefined && v.authMethod !== 'session-cookie') throw new Error('Runtime configuration unavailable');
  return { mode: 'account', ...(v.authMethod ? {authMethod:v.authMethod} : {}), firebase: { apiKey: v.firebase.apiKey, projectId: v.firebase.projectId, authDomain: v.firebase.authDomain }, ...(typeof v.emailLinkContinueUrl === 'string' ? { emailLinkContinueUrl: v.emailLinkContinueUrl } : {}) };
}
export async function loadRuntimeConfig(signal?: AbortSignal, fetchFn: typeof fetch = fetch) {
  const response = await fetchFn('/api/runtime-config', { cache: 'no-store', credentials: 'omit', redirect: 'error', signal });
  if (!response.ok) throw new Error('Runtime configuration unavailable');
  return parseRuntimeConfig(await response.json());
}

export class SessionChangedError extends Error { constructor() { super('The workspace session changed. The previous response was discarded.'); } }
export async function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const snapshot = state;
  if (snapshot.mode !== 'local' && !(snapshot.mode === 'account' && (snapshot.idToken || snapshot.cookieAuthenticated))) throw new Error('Sign in before accessing your workspace.');
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
  if (url.origin !== window.location.origin || !(url.pathname === '/api' || url.pathname.startsWith('/api/'))) throw new Error('Workspace requests must use this runtime.');
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  if (snapshot.mode === 'account' && snapshot.idToken) headers.set('Authorization', `Bearer ${snapshot.idToken}`);
  else headers.delete('Authorization');
  const cookie = snapshot.mode === 'account' && snapshot.cookieAuthenticated === true;
  if (cookie && !['GET','HEAD','OPTIONS'].includes((init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase())) headers.set('X-Steel-CSRF','1');
  const source = input instanceof Request ? input : url.toString();
  const response = await fetch(source, { ...init, headers, credentials: cookie ? 'same-origin' : 'omit', cache: 'no-store', redirect: 'error' });
  if (!sessionIsCurrent(snapshot.epoch)) throw new SessionChangedError();
  if (snapshot.mode === 'account' && response.status === 401) {
    endAccount('Your session expired or this account is not authorized. Sign in again or contact the server owner.');
    throw new SessionChangedError();
  }
  // A logout can happen during body parsing too, not just during fetch().
  const guard = <T,>(read: () => Promise<T>) => async () => { const result = await read(); if (!sessionIsCurrent(snapshot.epoch)) throw new SessionChangedError(); return result; };
  for (const method of ['json', 'text', 'blob', 'arrayBuffer', 'formData'] as const) {
    const original = response[method].bind(response) as () => Promise<any>;
    Object.defineProperty(response, method, { value: guard(original), configurable: true });
  }
  const clone = response.clone.bind(response);
  Object.defineProperty(response, 'clone', { value: () => {
    const copy = clone();
    for (const method of ['json', 'text', 'blob', 'arrayBuffer', 'formData'] as const) {
      const original = copy[method].bind(copy) as () => Promise<any>;
      Object.defineProperty(copy, method, { value: guard(original), configurable: true });
    }
    return copy;
  } });
  return response;
}
