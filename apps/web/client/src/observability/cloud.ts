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
  config?: { rules?: Array<{ goto?: string }>; [key: string]: unknown };
};
export type Definition = {
  objective?: string;
  name?: string;
  steps?: Step[];
  ui?: { positions?: Record<string, { x: number; y: number }> };
};
export type Entry = {
  id: string | number;
  at?: string;
  level: 'info' | 'error';
  kind?: 'run' | 'tool' | 'provider';
  step_id?: string | null;
  status?: string;
  message: string;
};

export function stepTimings(entries: Entry[], end: number) {
  const pending = new Map<string, number>();
  const rows: { step: string; start: number; duration: number; status: string }[] = [];
  for (const entry of entries) {
    if (!entry.step_id || !entry.at) continue;
    const at = Date.parse(entry.at);
    if (!Number.isFinite(at)) continue;
    if (entry.status === 'step_started') pending.set(entry.step_id, at);
    if (!['step_completed','step_failed','step_paused'].includes(entry.status ?? '')) continue;
    const start = pending.get(entry.step_id);
    if (start === undefined) continue;
    pending.delete(entry.step_id);
    rows.push({step:entry.step_id, start, duration:Math.max(0,at-start), status:entry.status!.slice(5)});
  }
  for (const [step,start] of pending) rows.push({step,start,duration:Math.max(0,end-start),status:'running'});
  return rows.sort((left, right) => left.start - right.start);
}

export const terminal = (status: string) =>
  ['sealed', 'failed', 'cancelled', 'local_completed', 'local_failed'].includes(status);
export const activeStep = (run: Run) =>
  ['running', 'local_running'].includes(run.status) ? run.current_step : null;

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
