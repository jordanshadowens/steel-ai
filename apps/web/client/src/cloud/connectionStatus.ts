import { useEffect, useState } from 'react';
import { getSession, sessionIsCurrent } from '../auth/session';

export type ConnectionStatus = {
  ai: {baseUrl: string; model: string} | null;
  database: {target?: string; host?: string; port?: number; database?: string; user: string; sslMode: string; customCa: boolean} | null;
};

export async function connectionRequest<T>(path = '', method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
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

export function useConnectionStatus(enabled: boolean) {
  const [status, setStatus] = useState<ConnectionStatus>();
  const [error, setError] = useState('');
  useEffect(() => {
    setStatus(undefined);
    setError('');
    if (!enabled) return;
    const controller = new AbortController();
    void connectionRequest<ConnectionStatus>('', 'GET', undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setStatus(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [enabled]);
  return {status, setStatus, error};
}
