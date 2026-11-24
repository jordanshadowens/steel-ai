import { useEffect, useRef, useState } from 'react';
import { useListWorkflowsQuery } from '../api/steelApi';
import { getSession, sessionIsCurrent } from '../auth/session';
import { ModalDialog } from '../app/FocusTrap';
import './api-keys.css';

type Key = { id: string; kind: string; personal?: boolean; name?: string; expiresAt: number; lastUsedAt?: number; revoked?: boolean; workflowIds?: string[] };
type Issued = Key & { key: string };
const tokenMetadata = ({ key: _secret, ...record }: Issued): Key => record;
const date = (seconds: number) => new Date(seconds * 1000).toLocaleDateString();
const status = (key: Key) => key.revoked ? 'Revoked' : key.expiresAt * 1000 <= Date.now() ? 'Expired' : 'Active';
const workflowLabel = (id: string) => id.replace(/[-_]+/g, ' ').replace(/(^| )([a-z])/g, (_, start: string, letter: string) => start + letter.toUpperCase());

async function keyRequest<T>(path = '', method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const session = getSession();
  if (!session.idToken && !session.cookieAuthenticated) throw new Error('Sign in to the cloud workspace before managing tokens.');
  const response = await fetch('/cloud-keys/api/account/keys' + path, {
    method, cache: 'no-store', credentials: session.cookieAuthenticated ? 'same-origin' : 'omit', redirect: 'error', signal,
    headers: {
      ...(session.idToken ? { Authorization: 'Bearer ' + session.idToken } : {}),
      ...(method !== 'GET' && session.cookieAuthenticated ? { 'X-Steel-CSRF': '1' } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!sessionIsCurrent(session.epoch)) throw new Error('Your workspace session changed.');
  if (!response.ok) throw new Error(value?.error || 'Unable to manage tokens.');
  return value;
}

export function ApiKeys() {
  const [keys, setKeys] = useState<Key[]>();
  const loadOrder = useRef(0);
  const changing = useRef(false);
  const [issued, setIssued] = useState<Issued>();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [days, setDays] = useState(30);
  const [selected, setSelected] = useState<string[]>([]);
  const [scopeSearch, setScopeSearch] = useState('');
  const [filter, setFilter] = useState('active');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [action, setAction] = useState<{ key: Key; kind: 'rotate' | 'revoke' }>();
  const versions = useListWorkflowsQuery('published');
  const workflows = [...new Map((versions.data?.workflows ?? []).map(item => [item.workflow_id, item.name || workflowLabel(item.workflow_id)])).entries()];
  const filteredWorkflows = workflows.filter(([id,name]) => (id + ' ' + name).toLowerCase().includes(scopeSearch.trim().toLowerCase()));
  const visible = keys?.filter(key => (filter === 'all' || (filter === 'active' ? status(key) === 'Active' : status(key) !== 'Active')) &&
    [key.name, ...key.workflowIds ?? []].join(' ').toLowerCase().includes(search.trim().toLowerCase()));

  async function load(signal?: AbortSignal) {
    const request = ++loadOrder.current;
    const { keys } = await keyRequest<{keys: Key[]}>('', 'GET', undefined, signal);
    if (!signal?.aborted && request === loadOrder.current) setKeys(keys);
  }
  useEffect(() => {
    const request = new AbortController();
    void load(request.signal).catch(cause => { if (!request.signal.aborted) setError(cause.message); });
    return () => request.abort();
  }, []);
  async function perform(task: () => Promise<void>) {
    if (changing.current) return;
    changing.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try { await task(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The request failed.'); }
    finally { changing.current = false; setBusy(false); }
  }
  const label = (key: Key) => key.name || (key.kind === 'developer' ? 'Developer key' : 'Account key');
  return <section className="workspace-keys">
    <header className="workspace-keys-title">
      <div><h1>Personal access tokens</h1><p>Connect a local agent or integration to published workflows in this workspace.</p></div>
      <button className="btn btn-primary" type="button" disabled={busy || !!issued} onClick={() => setCreating(!creating)}>{creating ? 'Close form' : 'Create token'}</button>
    </header>
    {error && <p className="workspace-keys-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {issued && <section className="workspace-keys-secret" aria-label="New personal access token">
      <h2>{label(issued)} is ready</h2>
      <p>Copy your token now. This is the only time it will be shown.</p>
      <code>{issued.key}</code>
      <div><button type="button" className="btn btn-primary" onClick={() => void perform(async () => { await navigator.clipboard.writeText(issued.key); setNotice('Token copied.'); })}>Copy token</button>
      <button type="button" className="btn" onClick={() => setIssued(undefined)}>Done</button></div>
    </section>}
    {creating && <form className="workspace-token-form" onSubmit={event => {
      event.preventDefault();
      void perform(async () => {
        const token = await keyRequest<Issued>('', 'POST', { name: name.trim(), workflowIds: selected, expiresInDays: days });
        setIssued(token);
        setKeys(current => [tokenMetadata(token), ...(current ?? [])]);
        setCreating(false);
        setSelected([]);
        setScopeSearch('');
        setName('');
        await load();
      });
    }}>
      <h2>New personal access token</h2>
      <div className="workspace-token-fields">
        <label>Token name<input required value={name} maxLength={40} pattern="[A-Za-z0-9 _\-]+" onChange={event => setName(event.target.value)} placeholder="Local Meta agent" /></label>
        <label>Expires in<select value={days} onChange={event => setDays(Number(event.target.value))}><option value="7">7 days</option><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option></select></label>
      </div>
      <fieldset><legend>Workflow access</legend>
        <p>Allow this token to read and run the selected workflows and send local run telemetry.</p>
        {versions.isLoading && <p role="status">Loading published workflows…</p>}
        {versions.isError && <button type="button" className="btn" onClick={() => void versions.refetch()}>Retry loading workflows</button>}
        {versions.isSuccess && workflows.length === 0 && <p>Publish a workflow in Creator to make it available here.</p>}
        {workflows.length > 8 && <label className="workspace-scope-search">Find published workflows
          <input type="search" value={scopeSearch} onChange={event => setScopeSearch(event.target.value)} placeholder="Workflow name or ID" />
          <small>{selected.length} selected</small>
        </label>}
        {scopeSearch && !filteredWorkflows.length && <p>No published workflows match your search.</p>}
        <div className="workspace-token-scopes">{filteredWorkflows.map(([id, name]) => <label key={id}>
          <input type="checkbox" checked={selected.includes(id)} disabled={!selected.includes(id) && selected.length >= 32}
            onChange={event => setSelected(current => event.target.checked ? [...current, id] : current.filter(scope => scope !== id))} />
          <span><strong>{name}</strong>{name !== id && <small>{id}</small>}</span>
        </label>)}</div>
      </fieldset>
      <button className="btn btn-primary" disabled={busy || !!issued || !name.trim() || !selected.length}>Create personal access token</button>
    </form>}
    <section className="workspace-key-list" aria-label="Workspace tokens">
      <div className="workspace-token-toolbar"><h2>Workspace tokens</h2><a href="/docs#workflow-execution">Developer API guide</a></div>
      <div className="workspace-token-tools">
        <label>Find tokens<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name or workflow" /></label>
        <label>Status<select value={filter} onChange={event => setFilter(event.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All tokens</option></select></label>
        <button type="button" className="btn" disabled={busy} onClick={() => void perform(() => load())}>Refresh</button>
      </div>
      {!keys && !error && <p role="status">Loading tokens…</p>}
      {visible?.length === 0 && <p>{keys?.length ? 'No tokens match your filters.' : 'No tokens yet.'}</p>}
      {visible?.map(key => <article className="workspace-key-row" key={key.id}>
        <div><strong>{label(key)}</strong><small>{key.personal ? 'Personal access token' : key.kind === 'developer' ? 'Legacy developer key' : 'Legacy account key'}</small>
          {key.workflowIds?.length ? <span className="workspace-token-tags">{key.workflowIds.map(id => <code key={id}>{id}</code>)}</span> : null}</div>
        <div><strong className="workspace-token-state" data-state={status(key)}>{status(key)}</strong><small>Expires {date(key.expiresAt)}</small><small>{key.lastUsedAt ? 'Last used ' + date(key.lastUsedAt) : 'Never used'}</small></div>
        {status(key) === 'Active' && <div className="workspace-token-actions">
          {key.personal && <button type="button" className="btn" disabled={busy || !!issued} aria-label={'Rotate ' + label(key)} onClick={() => setAction({key, kind:'rotate'})}>Rotate</button>}
          <button type="button" className="btn" disabled={busy} aria-label={'Revoke ' + label(key)} onClick={() => setAction({key, kind:'revoke'})}>Revoke</button>
        </div>}
      </article>)}
    </section>
    {action && <ModalDialog label={action.kind === 'rotate' ? 'Rotate token' : 'Revoke token'} onClose={() => {if (!busy) setAction(undefined);}}>
      <h2>{action.kind === 'rotate' ? 'Rotate' : 'Revoke'} {label(action.key)}?</h2>
      <p>Integrations using the current token will lose access immediately.{action.kind === 'rotate' && ' The replacement keeps the same workflow access and expiry date.'}</p>
      <button type="button" className="btn" disabled={busy} onClick={() => setAction(undefined)}>Cancel</button>{' '}
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => {
        const {key, kind} = action;
        setAction(undefined);
        void perform(async () => {
          const replacement = kind === 'rotate'
            ? await keyRequest<Issued>('/' + key.id + '/rotate', 'POST')
            : await keyRequest<undefined>('/' + key.id, 'DELETE');
          const currentToken = replacement ? tokenMetadata(replacement) : undefined;
          setKeys(current => {
            const rows = (current ?? []).map(row => row.id === key.id ? {...row, revoked:true} : row);
            return currentToken ? [currentToken, ...rows] : rows;
          });
          if (replacement) setIssued(replacement);
          else setNotice('Token revoked.');
          await load();
        });
      }}>{action.kind === 'rotate' ? 'Rotate token' : 'Revoke token'}</button>
    </ModalDialog>}
  </section>;
}
