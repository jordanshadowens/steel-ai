import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { acceptAccount, authenticatedFetch, configureRuntime, endAccount, getSession, loadRuntimeConfig, parseRuntimeConfig } from './session';
const config = { mode: 'account' as const, firebase: { apiKey: 'test-public-key', projectId: 'test-project', authDomain: 'test-project.firebaseapp.com' } };
function login(uid = 'alice', token = 'test-alice-secret') { configureRuntime(config); acceptAccount({ localId: uid, email: uid + '@example.invalid', idToken: token }); }
beforeEach(() => { vi.useFakeTimers(); configureRuntime(config); });
afterEach(() => { endAccount(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('fails closed on missing, unauthorized and malformed runtime configuration', async () => {
  expect(() => parseRuntimeConfig({ mode: 'account' })).toThrow();
  expect(() => parseRuntimeConfig({})).toThrow();
  await expect(loadRuntimeConfig(undefined, vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))).rejects.toThrow();
  const f = vi.fn(); vi.stubGlobal('fetch', f);
  await expect(authenticatedFetch('/api/skills')).rejects.toThrow('Sign in'); expect(f).not.toHaveBeenCalled();
});
it('uses account headers only for same-origin runtime APIs and local mode removes auth', async () => {
  login(); const f = vi.fn().mockImplementation(async () => new Response('{"skills":[]}')); vi.stubGlobal('fetch', f);
  await (await authenticatedFetch('/api/skills')).json();
  expect(new Headers(f.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer test-alice-secret');
  await expect(authenticatedFetch('https://other.example/api/skills')).rejects.toThrow('this runtime');
  await expect(authenticatedFetch('/not-api')).rejects.toThrow('this runtime');
  configureRuntime({ mode: 'local' });
  await authenticatedFetch('/api/skills', { headers: { Authorization: 'Bearer stale' } });
  expect(new Headers(f.mock.calls[1][1].headers).has('Authorization')).toBe(false);
});
it('discards a prior account response while fetch is in flight', async () => {
  login(); let done!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { done = resolve; })));
  const pending = authenticatedFetch('/api/skills');
  endAccount(); acceptAccount({ localId: 'bob', email: 'bob@example.invalid', idToken: 'bob-secret' });
  done(new Response('{"skills":["alice-private"]}'));
  await expect(pending).rejects.toThrow('discarded');
});
it('also guards response and cloned response body parsing after a session change', async () => {
  login(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"private":"alice"}')));
  const r = await authenticatedFetch('/api/skills'); const clone = r.clone();
  endAccount();
  await expect(r.json()).rejects.toThrow('discarded');
  await expect(clone.json()).rejects.toThrow('discarded');
});
it('clears an expired account and never persists its token', async () => {
  login(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
  await expect(authenticatedFetch('/api/workflows')).rejects.toThrow('discarded');
  expect(getSession().idToken).toBeUndefined();
  expect(getSession().message).toContain('not authorized');
  expect(JSON.stringify(window.sessionStorage)).not.toContain('test-alice-secret');
});
