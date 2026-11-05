import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountGate } from './AccountGate';
import { configureRuntime, endAccount, getSession } from './session';

const config = { mode: 'account' as const, firebase: { apiKey: 'synthetic-public-key', projectId: 'test', authDomain: 'test.firebaseapp.com' } };
beforeEach(() => { sessionStorage.clear(); window.history.replaceState(null, '', '/app/'); configureRuntime(config); });
afterEach(() => { cleanup(); endAccount(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

it('keeps protected views unmounted when runtime configuration cannot be verified', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, 401)));
  render(<AccountGate><div>Private Creator</div></AccountGate>);
  expect((await screen.findByRole('alert')).textContent).toContain('Unable to verify this runtime');
  expect(screen.queryByText('Private Creator')).toBeNull();
});

it('does not accept a valid-looking Firebase response before the runtime authorizes the account', async () => {
  window.history.replaceState(null, '', '/app/?mode=signIn&oobCode=synthetic-code');
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    if (String(url) === '/api/runtime-config') return response(config);
    if (String(url).startsWith('https://identitytoolkit.googleapis.com/')) return response({ idToken: 'synthetic-token', localId: 'alice', email: 'alice@example.invalid', expiresIn: '3600' });
    if (String(url) === '/api/workspace') return response({ error: 'Not provisioned' }, 401);
    throw new Error('Unexpected test request');
  });
  vi.stubGlobal('fetch', fetcher);
  render(<AccountGate><div>Private Creator</div></AccountGate>);
  await screen.findByRole('button', { name: 'Confirm email and sign in' });
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'alice@example.invalid' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm email and sign in' }));
  await screen.findByText('This account is not provisioned on this runtime, or its session expired. Contact the server owner.');
  expect(screen.queryByText('Private Creator')).toBeNull();
  expect(getSession().idToken).toBeUndefined();
  expect(window.location.search).not.toContain('oobCode');
  expect(JSON.stringify(sessionStorage)).not.toContain('synthetic-token');
});

it('mounts only an authorized private workspace and removes it synchronously on signout', async () => {
  window.history.replaceState(null, '', '/app/?mode=signIn&oobCode=synthetic-code');
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url) === '/api/runtime-config') return response(config);
    if (String(url).startsWith('https://identitytoolkit.googleapis.com/')) return response({ idToken: 'synthetic-token', localId: 'alice', email: 'alice@example.invalid', expiresIn: '3600' });
    if (String(url) === '/api/workspace') {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer synthetic-token');
      return response({ mode: 'account', skillsScope: 'account' });
    }
    throw new Error('Unexpected test request');
  }));
  render(<AccountGate><div>Private Creator</div></AccountGate>);
  await screen.findByRole('button', { name: 'Confirm email and sign in' });
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'alice@example.invalid' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm email and sign in' }));
  expect(await screen.findByText('Private Creator')).toBeTruthy();
  expect(getSession().uid).toBe('alice');
  act(() => endAccount());
  expect(screen.queryByText('Private Creator')).toBeNull();
  expect(screen.getByRole('button', { name: 'Send sign-in link' })).toBeTruthy();
});

it('restores an owner website session only after runtime workspace confirmation, without another login',async()=>{
 const f=vi.fn(async(url:string|URL|Request,init?:RequestInit)=>{
  if(String(url)==='/api/runtime-config')return response({...config,authMethod:'session-cookie'});
  expect(init?.credentials).toBe('same-origin');
  if(String(url)==='/api/session')return response({uid:'owner',email:'owner@example.invalid',expiresAt:Date.now()+60000,access:{runtimePreviewEligible:true}});
  if(String(url)==='/api/workspace')return response({mode:'account',skillsScope:'account'});
  throw new Error('Unexpected request');
 });vi.stubGlobal('fetch',f);
 render(<AccountGate><div>Private Creator</div></AccountGate>);
 expect(await screen.findByText('Private Creator')).toBeTruthy();
 expect(getSession().cookieAuthenticated).toBe(true);expect(getSession().idToken).toBeUndefined();
 expect(screen.queryByLabelText('Email address')).toBeNull();
});
it('waitlist website session cannot mount Creator',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string|URL|Request)=>String(url)==='/api/runtime-config'?response({...config,authMethod:'session-cookie'}):response({uid:'other',email:'other@example.invalid',expiresAt:Date.now()+60000,access:{runtimePreviewEligible:false}})));
 render(<AccountGate><div>Private Creator</div></AccountGate>);
 await screen.findByRole('alert');expect(screen.queryByText('Private Creator')).toBeNull();
});
it('signed-out hosted app points to website sign-in instead of presenting a second email form',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string|URL|Request)=>String(url)==='/api/runtime-config'?response({...config,authMethod:'session-cookie'}):response({},401)));
 render(<AccountGate><div>Private Creator</div></AccountGate>);
 expect((await screen.findByRole('link',{name:'Go to website sign-in'})).getAttribute('href')).toBe('/?signin=1');
 expect(screen.queryByLabelText('Email address')).toBeNull();expect(screen.queryByText('Private Creator')).toBeNull();
});
