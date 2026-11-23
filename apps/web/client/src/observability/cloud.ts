import { authenticatedFetch } from '../auth/session';

export type Run = {
  run_id: string;
  workflow_id: string;
  version: number;
  status: string;
  current_step?: string | null;
  created_at?: string;
  updated_at?: string;
  snapshot?: { error?: string };
};

export type Step = {
  step_id: string;
  name?: string;
  type: string;
  on_success?: string;
  on_failure?: string;
  config?: { rules?: Array<{ goto?: string }> };
};
export type Definition = {
  steps?: Step[];
  ui?: { positions?: Record<string, { x: number; y: number }> };
};
export type Entry = {
  id: string | number;
  at?: string;
  level: 'info' | 'error';
  kind?: 'run' | 'tool';
  message: string;
};

export const terminal = (status: string) =>
  ['sealed', 'failed', 'cancelled'].includes(status);
export const activeStep = (run: Run) =>
  run.status === 'running' ? run.current_step : null;

export function runEntries(run: Run, calls: Entry[] = []): Entry[] {
  const status = run.status.replaceAll('_', ' ');
  const hasHistory = calls.some((entry) => entry.kind === 'run');
  const failure = run.snapshot?.error;
  const entries: Entry[] = [
    {
      id: 'created',
      at: run.created_at,
      level: 'info',
      message: 'Run created',
    },
    ...calls,
  ];
  if (!hasHistory || failure) {
    entries.push({
      id: 'status',
      at: run.updated_at,
      level: run.status === 'failed' ? 'error' : 'info',
      message:
        failure ||
        (run.current_step ? status + ' · ' + run.current_step : status),
    });
  }
  return entries.sort(
    (a, b) => (Date.parse(a.at || '') || 0) - (Date.parse(b.at || '') || 0),
  );
}

export async function runtime<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await authenticatedFetch('/api' + path, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Unable to load runtime data (' + response.status + ').');
  }
  return response.json();
}
