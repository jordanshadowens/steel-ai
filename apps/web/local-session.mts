import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const COOKIE = 'steel_local_session';
const MAX_RECORDS = 100;
type Pending = { email: string; apiKey: string; expiresAt: number };
type Session = { idToken: string; expiresAt: number; sessionRef: string };

export function localAccountSession(runtime: string, fetchFn = fetch): Plugin {
  const pending = new Map<string, Pending>();
  const sessions = new Map<string, Session>();
  const newId = () => randomBytes(32).toString('base64url');
  const cookieId = (req: IncomingMessage) =>
    req.headers.cookie?.match(/(?:^|;\s*)steel_local_session=([\w-]{43})(?:;|$)/)?.[1] ?? '';
  const setCookie = (res: ServerResponse, id: string, expiresAt: number) => {
    const age = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    res.setHeader('Set-Cookie', `${COOKIE}=${id}; Path=/api; Max-Age=${age}; HttpOnly; SameSite=Strict`);
  };
  const reply = (res: ServerResponse, status: number, body?: unknown) => {
    res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };
  async function readBody(req: IncomingMessage) {
    let body = '';
    for await (const part of req) {
      body += part.toString();
      if (body.length > 4096) throw new Error('Invalid sign-in request.');
    }
    return JSON.parse(body);
  }
  async function runtimeConfig() {
    const response = await fetchFn(new URL('/api/runtime-config', runtime), {
      redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Runtime configuration unavailable.');
    return response.json();
  }
  async function firebase(action: string, apiKey: string, body: object) {
    const url = new URL(`https://identitytoolkit.googleapis.com/v1/accounts:${action}`);
    url.searchParams.set('key', apiKey);
    const response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Unable to use the sign-in link. Request a new link.');
    return response.json();
  }
  function workspace(idToken: string) {
    return fetchFn(new URL('/api/workspace', runtime), {
      headers: { Authorization: `Bearer ${idToken}` },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
  }
  return {
    name: 'steel-local-account-session',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (!path.startsWith('/api/')) return next();
        const host = req.headers.host ?? '';
        if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)) return next();
        const protocol = server.config.server.https ? 'https' : 'http';
        const origin = `${protocol}://${host}`;
        const safe = ['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? '');
        const trusted = req.headers['sec-fetch-site'] !== 'cross-site' &&
          (safe
            ? !req.headers.origin || req.headers.origin === origin
            : req.headers.origin === origin && req.headers['x-steel-csrf'] === '1');
        const id = cookieId(req);
        for (const records of [pending, sessions]) {
          for (const [key, record] of records) {
            if (record.expiresAt <= Date.now()) records.delete(key);
          }
        }
        const session = sessions.get(id);
        try {
          if (path === '/api/runtime-config' && req.method === 'GET') {
            const config = await runtimeConfig();
            return reply(res, 200, config.mode === 'account'
              ? { ...config, authMethod: 'session-cookie' }
              : config);
          }
          if (path === '/api/session' || path.startsWith('/api/session/email/')) {
            if (!trusted) return reply(res, 403, { error: 'Open Steel on localhost to sign in.' });
            if (path === '/api/session' && req.method === 'GET') {
              if (!session) return reply(res, 401);
              const verified = await workspace(session.idToken);
              if (verified.status === 401 || verified.status === 403) {
                sessions.delete(id);
                return reply(res, 401);
              }
              if (!verified.ok) return reply(res, 502);
              if (sessions.get(id) !== session || session.expiresAt <= Date.now()) {
                return reply(res, 401);
              }
              return reply(res, 200, {
                expiresAt: session.expiresAt,
                sessionRef: session.sessionRef,
                access: { runtimePreviewEligible: true },
              });
            }
            if (path === '/api/session' && req.method === 'DELETE') {
              sessions.delete(id);
              pending.delete(id);
              setCookie(res, '', 0);
              return reply(res, 204);
            }
            if (req.method !== 'POST') return reply(res, 405);
            const body = await readBody(req);
            if (path === '/api/session/email/request') {
              if (session) return reply(res, 409);
              const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
              if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(res, 400);
              const config = await runtimeConfig();
              if (config.mode !== 'account' || typeof config.firebase?.apiKey !== 'string') return reply(res, 503);
              pending.delete(id);
              if (pending.size >= MAX_RECORDS) return reply(res, 429);
              const key = newId();
              const expiresAt = Date.now() + 15 * 60 * 1000;
              pending.set(key, { email, apiKey: config.firebase.apiKey, expiresAt });
              try {
                await firebase('sendOobCode', config.firebase.apiKey, {
                  email, requestType: 'EMAIL_SIGNIN', canHandleCodeInApp: true,
                  continueUrl: new URL('/app/', origin).href,
                });
              } catch (error) {
                pending.delete(key);
                throw error;
              }
              setCookie(res, key, expiresAt);
              return reply(res, 204);
            }
            if (path === '/api/session/email/complete') {
              const record = pending.get(id);
              if (!record || typeof body?.code !== 'string' || !body.code || body.code.length > 2048) return reply(res, 400);
              if (sessions.size >= MAX_RECORDS) return reply(res, 429);
              pending.delete(id);
              const result = await firebase('signInWithEmailLink', record.apiKey, {
                email: record.email, oobCode: body.code, returnSecureToken: true,
              });
              const seconds = Number(result.expiresIn);
              if (typeof result.idToken !== 'string' || !result.idToken ||
                result.email?.toLowerCase() !== record.email ||
                !Number.isFinite(seconds) || seconds <= 0) return reply(res, 401);
              const verified = await workspace(result.idToken);
              if (!verified.ok) return reply(res, 403);
              const view = await verified.json();
              if (view.mode !== 'account' || view.skillsScope !== 'account') return reply(res, 403);
              if (sessions.size >= MAX_RECORDS) return reply(res, 429);
              const key = newId();
              const expiresAt = Date.now() + Math.min(seconds, 3600) * 1000;
              sessions.set(key, { idToken: result.idToken, expiresAt, sessionRef: newId() });
              setCookie(res, key, expiresAt);
              return reply(res, 204);
            }
            return reply(res, 404);
          }
          if (session && !req.headers.authorization) {
            if (!trusted) return reply(res, 403);
            req.headers.authorization = `Bearer ${session.idToken}`;
          }
          // The local cookie is only meaningful to this development server.
          if (id) {
            req.headers.cookie = req.headers.cookie?.split(';')
              .filter((value) => !value.trim().startsWith(`${COOKIE}=`)).join(';');
          }
          return next();
        } catch {
          return reply(res, 502, { error: 'Unable to verify sign-in with the runtime.' });
        }
      });
    },
  };
}
