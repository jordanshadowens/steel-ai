import { useState, type FormEvent } from 'react';
import { connectionRequest, useConnectionStatus, type ConnectionStatus } from './connectionStatus';
import './api-keys.css';

type Kind = 'ai' | 'database';
export function Connections({section}: {section: Kind}) {
  const {status, setStatus, error: loadError} = useConnectionStatus(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function update(kind: Kind, form?: HTMLFormElement, test = false) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    const body = form ? Object.fromEntries(new FormData(form)) : undefined;
    try {
      await connectionRequest('/' + kind, form ? (test ? 'POST' : 'PUT') : 'DELETE', body);
      if (test) { setNotice('Connection test passed.'); return; }
      const secretInput = form?.querySelector<HTMLInputElement>('input[type="password"]');
      if (secretInput) secretInput.value = '';
      setNotice(form ? 'Connection tested and saved.' : 'Connection disconnected.');
      setStatus(await connectionRequest<ConnectionStatus>());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to manage workspace connections.');
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>, kind: Kind) {
    event.preventDefault();
    void update(kind, event.currentTarget, (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'test');
  }

  const ai = status?.ai;
  const database = status?.database;
  return <>
    {(error || loadError) && <p role="alert" className="workspace-keys-error">{error || loadError}</p>}
    {notice && <p role="status">{notice}</p>}
    {!status && !error && !loadError && <p role="status">Loading connections…</p>}
    {section === 'ai' && <section className="workspace-setting" id="settings-ai" tabIndex={-1} aria-labelledby="settings-ai-title">
      <header className="workspace-setting-heading">
        <div>
          <h2 id="settings-ai-title">AI provider</h2>
          {status && <p>{ai ? ai.model + ' · ' + ai.baseUrl : 'No AI provider configured'}</p>}
        </div>
      </header>
      {status && <form className="workspace-token-form" method="post" onSubmit={event => submit(event, 'ai')} autoComplete="off">
        <p>A custom provider receives your AI Assist prompts and workflow context.</p>
        <label>Provider URL <input name="baseUrl" type="url" defaultValue={ai?.baseUrl} placeholder="https://provider.example/v1" required maxLength={2048} disabled={busy} /></label>
        <small>Use a public HTTPS base URL or an OpenAI-compatible Chat Completions endpoint.</small>
        <label>Model ID <input name="model" defaultValue={ai?.model} required maxLength={256} disabled={busy} /></label>
        <label>API key <input name="apiKey" type="password" autoComplete="new-password" required maxLength={2048} disabled={busy} /></label>
        <div className="workspace-setting-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>Test and save</button>
          <button type="submit" className="btn" value="test" disabled={busy}>Test connection</button>
          {ai && <button type="button" className="btn" disabled={busy} onClick={() => void update('ai')}>Disconnect</button>}
        </div>
      </form>}
    </section>}
    {section === 'database' && <section className="workspace-setting" id="settings-database" tabIndex={-1} aria-labelledby="settings-database-title">
      <header className="workspace-setting-heading">
        <div>
          <h2 id="settings-database-title">PostgreSQL</h2>
          {status && <p>{database?.host ? database.host + ':' + database.port + '/' + database.database : database?.target ?? 'SQLite (workspace default)'}</p>}
        </div>
      </header>
      {status && <form className="workspace-token-form" method="post" onSubmit={event => submit(event, 'database')} autoComplete="off">
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
          <button type="submit" className="btn" value="test" disabled={busy}>Test connection</button>
          {database && <button type="button" className="btn" disabled={busy} onClick={() => void update('database')}>Disconnect</button>}
        </div>
      </form>}
    </section>}
  </>;
}
