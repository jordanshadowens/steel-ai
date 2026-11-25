import { useEffect, useState, type FormEvent } from 'react';
import { getSession, sessionIsCurrent } from '../auth/session';
import './api-keys.css';

type Kind = 'ai' | 'database';
type Status = {
  ai: {baseUrl: string; model: string} | null;
  database: {target?: string; host?: string; port?: number; database?: string; user: string; sslMode: string; customCa: boolean} | null;

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
  const [editing, setEditing] = useState<Kind>();

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
      setEditing(undefined);
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

  const ai = status?.ai;
  const database = status?.database;
  return <>
    {error && <p role="alert" className="workspace-keys-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!status && !error && <p role="status">Loading connections…</p>}
    <section className="workspace-setting" id="settings-ai" tabIndex={-1} aria-labelledby="settings-ai-title">
      <header className="workspace-setting-heading">
        <div>
          <h2 id="settings-ai-title">AI provider</h2>
          {status && <p>{ai ? ai.model + ' · ' + ai.baseUrl : 'Hosted Vertex'}</p>}
        </div>
        {status && <button className="btn" type="button" aria-expanded={editing === 'ai'} disabled={busy}
          onClick={() => setEditing(editing === 'ai' ? undefined : 'ai')}>{editing === 'ai' ? 'Close' : 'Configure'}</button>}
      </header>
      {editing === 'ai' && <form className="workspace-token-form" method="post" onSubmit={event => submit(event, 'ai')} autoComplete="off">
        <p>A custom provider receives your AI Assist prompts and workflow context.</p>
        <label>Provider URL <input name="baseUrl" type="url" defaultValue={ai?.baseUrl} placeholder="https://provider.example/v1" required maxLength={2048} disabled={busy} /></label>
        <small>Use a public HTTPS base URL or an OpenAI-compatible Chat Completions endpoint.</small>
        <label>Model ID <input name="model" defaultValue={ai?.model} required maxLength={256} disabled={busy} /></label>
        <label>API key <input name="apiKey" type="password" autoComplete="new-password" required maxLength={2048} disabled={busy} /></label>
        <div className="workspace-setting-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>Save provider</button>
          {ai && <button type="button" className="btn" disabled={busy} onClick={() => void update('ai')}>Use hosted Vertex</button>}
        </div>
      </form>}
    </section>
    <section className="workspace-setting" id="settings-database" tabIndex={-1} aria-labelledby="settings-database-title">
      <header className="workspace-setting-heading">
        <div>
          <h2 id="settings-database-title">PostgreSQL</h2>
          {status && <p>{database?.host ? database.host + ':' + database.port + '/' + database.database : database?.target ?? 'No database configured'}</p>}
        </div>
        {status && <button className="btn" type="button" aria-expanded={editing === 'database'} disabled={busy}
          onClick={() => setEditing(editing === 'database' ? undefined : 'database')}>{editing === 'database' ? 'Close' : 'Configure'}</button>}
      </header>
      {editing === 'database' && <form className="workspace-token-form" method="post" onSubmit={event => submit(event, 'database')} autoComplete="off">
        <p>Saving tests the connection. Data Designer and Runner currently use workspace storage.</p>
        <div className="workspace-setting-fields">
          <label>Hostname <input name="host" defaultValue={database?.host} placeholder="db.example.com" required maxLength={253} disabled={busy} /></label>
          <label>Port <input name="port" type="number" min={1} max={65535} defaultValue={database?.port ?? 5432} required disabled={busy} /></label>
        </div>
        <label>Database name <input name="database" defaultValue={database?.database} required maxLength={63} disabled={busy} /></label>
        <label>Username <input name="user" defaultValue={database?.user} required maxLength={128} disabled={busy} /></label>
        <label>Password <input name="password" type="password" autoComplete="new-password" required maxLength={2048} disabled={busy} /></label>
        <p>TLS mode <strong>Verify server certificate and hostname</strong></p>
        <label>CA certificate (optional PEM)
          <textarea name="ca" rows={4} maxLength={12000} disabled={busy} placeholder="-----BEGIN CERTIFICATE-----" />
        </label>
        {database?.customCa && <small>Paste the custom CA again if the database still requires it.</small>}
        <div className="workspace-setting-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>Test and save</button>
          {database && <button type="button" className="btn" disabled={busy} onClick={() => void update('database')}>Disconnect</button>}
        </div>
      </form>}
    </section>
  </>;
}
