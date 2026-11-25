import { useEffect, useState, type FormEvent } from 'react';
import { getSession, sessionIsCurrent } from '../auth/session';
import './api-keys.css';

type Kind = 'ai' | 'database';
type Status = {
  ai: {baseUrl: string; model: string} | null;
  database: {target: string} | null;
  databaseTargets: string[];
};

async function connectionRequest<T>(path = '', method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const session = getSession();
  if (!session.cookieAuthenticated) throw new Error('Sign in to manage workspace connections.');
  const response = await fetch('/cloud-runtime/api/connections' + path, {
    method, cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal,
    headers: {
      ...(method !== 'GET' ? {'X-Steel-CSRF': '1'} : {}),
      ...(body ? {'Content-Type': 'application/json'} : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!sessionIsCurrent(session.epoch)) throw new Error('Your workspace session changed.');
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Unable to manage workspace connections.');
  return value;
}

export function Connections() {
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void connectionRequest<Status>('', 'GET', undefined, controller.signal)
      .then(setStatus)
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, []);

  async function update(kind: Kind, form?: HTMLFormElement) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    const body = form ? Object.fromEntries(new FormData(form)) : undefined;
    try {
      await connectionRequest('/' + kind, form ? 'PUT' : 'DELETE', body);
      form?.reset();
      setNotice(form ? 'Connection saved.' : 'Connection disconnected.');
      setStatus(await connectionRequest<Status>());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to manage workspace connections.');
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>, kind: Kind) {
    event.preventDefault();
    void update(kind, event.currentTarget);
  }

  return <section className="workspace-keys">
    <header className="workspace-keys-title"><h1>Connections</h1></header>
    {error && <p role="alert" className="workspace-keys-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!status && !error && <p role="status">Loading connections…</p>}
    {status && <>
      <form className="workspace-token-form" method="post" onSubmit={event => submit(event, 'ai')} autoComplete="off">
        <h2>AI provider</h2>
        <p>{status.ai ? 'Active model: ' + status.ai.model : 'AI Assist uses the hosted Vertex model.'} A custom provider receives your AI Assist prompts and workflow context.</p>
        <label>Provider URL <input name="baseUrl" type="url" key={status.ai?.baseUrl} defaultValue={status.ai?.baseUrl} placeholder="https://provider.example/v1" required maxLength={2048} disabled={busy} /></label>
        <small>Use a public HTTPS base URL or an OpenAI-compatible Chat Completions endpoint.</small>
        <label>Model ID <input name="model" key={status.ai?.model} defaultValue={status.ai?.model} required maxLength={256} disabled={busy} /></label>
        <label>API key <input name="apiKey" type="password" autoComplete="new-password" required maxLength={2048} disabled={busy} /></label>
        <div>
          <button type="submit" className="btn" disabled={busy}>{status.ai ? 'Update provider' : 'Connect provider'}</button>{' '}
          {status.ai && <button type="button" className="btn" disabled={busy} onClick={() => void update('ai')}>Use hosted Vertex</button>}
        </div>
      </form>
      <form className="workspace-token-form" method="post" onSubmit={event => submit(event, 'database')} autoComplete="off">
        <h2>PostgreSQL</h2>
        <p>{status.database ? 'Saved connection: ' + status.database.target : 'No connection saved.'} Saving runs a connection test. Workflows and Data Designer continue to use workspace storage.</p>
        {status.databaseTargets.length ? <>
          <label>Database <select name="target" key={status.database?.target} defaultValue={status.database?.target ?? ''} required disabled={busy}>
            <option value="">Select a database</option>
            {status.databaseTargets.map(target => <option key={target}>{target}</option>)}
          </select></label>
          <label>Database username <input name="user" required maxLength={128} disabled={busy} /></label>
          <label>Database password <input name="password" type="password" autoComplete="new-password" required maxLength={2048} disabled={busy} /></label>
          <button type="submit" className="btn" disabled={busy}>Test and save</button>
        </> : <p>No PostgreSQL targets are available in this environment.</p>}
        {status.database && <button type="button" className="btn" disabled={busy} onClick={() => void update('database')}>Disconnect PostgreSQL</button>}
      </form>
    </>}
  </section>;
}
