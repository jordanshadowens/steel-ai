import { useEffect, useState } from 'react';
import { useListWorkflowsQuery } from '../api/steelApi';
import { getSession, sessionIsCurrent } from '../auth/session';
import './api-keys.css';

type Key = { id: string; kind: string; name?: string; expiresAt: number; revoked?: boolean; workflowIds?: string[] };
type Issued = Key & {key: string};

async function keyRequest<T>(path: string, method = 'GET', body?: unknown, parent?: string, signal?: AbortSignal): Promise<T> {
  const session = getSession();
  if (!session.idToken && !session.cookieAuthenticated) throw new Error('Sign in to the cloud workspace before managing keys.');
  const response = await fetch(parent ? '/cloud-keys/api/dev-keys' : '/cloud-keys/api/account/keys' + path, {
    method,
    cache: 'no-store',
    credentials: session.cookieAuthenticated ? 'same-origin' : 'omit',
    redirect: 'error',
    signal,
    headers: {
      ...(parent || session.idToken ? {Authorization: 'Bearer ' + (parent || session.idToken)} : {}),
      ...(method !== 'GET' && session.cookieAuthenticated ? {'X-Steel-CSRF': '1'} : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = response.status === 204 ? undefined : await response.json();
  if (!sessionIsCurrent(session.epoch)) throw new Error('Your workspace session changed.');
  if (!response.ok) throw new Error(value?.error || 'Unable to manage API keys.');
  return value;
}

export function ApiKeys() {
  const [keys, setKeys] = useState<Key[]>();
  const [issued, setIssued] = useState<Issued>();
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [scope, setScope] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const versions = useListWorkflowsQuery('published');
  const workflows = [...new Map((versions.data?.workflows ?? []).map(item => [item.workflow_id, item.name || item.workflow_id])).entries()];

  async function load(signal?: AbortSignal) {
    const value = await keyRequest<{keys: Key[]}>('', 'GET', undefined, undefined, signal);
    if (!signal?.aborted) setKeys(value.keys);
  }

  useEffect(() => {
    const request = new AbortController();
    void load(request.signal).catch(cause => {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load keys.');
    });
    return () => request.abort();
  }, []);

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The request failed.'); }
    finally { setBusy(false); }
  }

  return <section className="workspace-keys">
    <div className="workspace-keys-title">
      <div><h1>API keys</h1><p>Manage credentials for this workspace and scope developer access to specific workflows.</p></div>
      <button type="button" className="btn" disabled={busy} onClick={() => void perform(() => load())}>Refresh</button>
    </div>
    {error && <p className="workspace-keys-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="workspace-keys-forms">
      <form onSubmit={event => {
        event.preventDefault();
        void perform(async () => {
          setIssued(await keyRequest<Issued>('', 'POST', {name: name.trim()}));
          setName('');
          await load();
        });
      }}>
        <h2>Create an account key</h2>
        <label>Key name<input value={name} maxLength={40} onChange={event => setName(event.target.value)} placeholder="Integration server" /></label>
        <button className="btn btn-primary" disabled={busy || Boolean(issued)}>Create account key</button>
      </form>
      <form onSubmit={event => {
        event.preventDefault();
        const workflowIds = [...new Set(scope.split(',').map(id => id.trim()).filter(Boolean))];
        if (!workflowIds.length || workflowIds.length > 32 || workflowIds.some(id => !/^[A-Za-z0-9_-]{1,128}$/.test(id))) {
          setError('Enter 1–32 valid workflow IDs.');
          return;
        }
        void perform(async () => {
          setIssued(await keyRequest<Issued>('', 'POST', {workflowIds}, parent.trim()));
          setParent('');
          setScope('');
          await load();
        });
      }}>
        <h2>Issue a developer key</h2>
        <label>Account API key<input type="password" autoComplete="off" value={parent} required onChange={event => setParent(event.target.value)} /></label>
        {workflows.length > 0 && <label>Add published workflow<select value="" onChange={event => {
          const id = event.target.value;
          if (id) setScope(current => [...new Set([...current.split(',').map(item => item.trim()).filter(Boolean), id])].join(', '));
        }}><option value="">Choose a workflow…</option>{workflows.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}
        <label>Workflow IDs<input value={scope} required onChange={event => setScope(event.target.value)} placeholder="purchase-review, monthly-report" /></label>
        <button className="btn btn-primary" disabled={busy || Boolean(issued)}>Create developer key</button>
      </form>
    </div>
    {issued && <div className="workspace-keys-secret" role="region" aria-label="New API key">
      <strong>Copy this key now. It’s shown once.</strong>
      <code>{issued.key}</code>
      <div>
        <button type="button" className="btn btn-primary" onClick={() => void perform(async () => {
          await navigator.clipboard.writeText(issued.key);
          setNotice('Key copied.');
        })}>Copy key</button>
        <button type="button" className="btn" onClick={() => setIssued(undefined)}>Dismiss</button>
      </div>
    </div>}
    <section className="workspace-key-list" aria-label="Issued API keys">
      <h2>Issued keys</h2>
      {!keys && !error && <p role="status">Loading keys…</p>}
      {keys?.length === 0 && <p>No keys issued for this workspace.</p>}
      {keys?.map(key => <div className="workspace-key-row" key={key.id}>
        <span><strong>{key.name || (key.kind === 'developer' ? 'Developer key' : 'Account key')}</strong><small>{key.id.slice(0, 10)} · {key.revoked ? 'Revoked' : 'Expires ' + new Date(key.expiresAt * 1000).toLocaleDateString()}</small></span>
        <span>{key.workflowIds?.join(', ')}</span>
        {!key.revoked && <button type="button" className="btn" disabled={busy} onClick={() => {
          if (window.confirm('Revoke this key? Integrations using it will lose access.')) {
            void perform(async () => { await keyRequest('/' + key.id, 'DELETE'); await load(); });
          }
        }}>Revoke</button>}
      </div>)}
    </section>
  </section>;
}
