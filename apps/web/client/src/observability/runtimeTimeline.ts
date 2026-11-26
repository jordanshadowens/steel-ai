import { useEffect, useRef, useState } from 'react';
import { runtime, terminal, type Entry, type Run } from './cloud';
import { title, type TimelineEvent } from './ExecutionTimeline';
import type { Trace, Verification } from './agentActivityApi';

type RuntimeEvent = Entry & {
  trace?: Trace;
  duration_ms?: number;
  evidence?: {result?: string; reason?: string; policy?: string; outputs?: unknown; verification?: Verification};
};
type Cursor = {event: number; tool: number};
type Detail = {run: Run; logs?: RuntimeEvent[]; next?: Cursor};

export function useRuntimeTimeline(runId?: string) {
  const [detail, setDetail] = useState<Detail>();
  const [older, setOlder] = useState<RuntimeEvent[]>([]);
  const [cursor, setCursor] = useState<Cursor>();
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const connection = useRef<AbortController>(null);
  useEffect(() => {
    setDetail(undefined);
    setOlder([]);
    setCursor(undefined);
    setError(false);
    if (!runId) return;
    const controller = new AbortController();
    connection.current = controller;
    let timer: ReturnType<typeof setTimeout>;
    const url = '/runs/' + encodeURIComponent(runId) + '?logs=1';
    async function load() {
      let done = false;
      try {
        const page = await runtime<Detail>(url, controller.signal);
        if (controller.signal.aborted) return;
        setDetail(page);
        setError(false);
        done = terminal(page.run.status);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
      if (!done && !controller.signal.aborted) timer = setTimeout(load, 5000);
    }
    void load();
    return () => {controller.abort(); clearTimeout(timer);};
  }, [runId, refresh]);
  const current = detail?.run.run_id === runId ? detail : undefined;
  const next = cursor ?? current?.next;
  const canPage = Boolean(next?.event || next?.tool);
  async function loadMore() {
    if (!runId || !next || paging || !canPage) return;
    const signal = connection.current?.signal;
    if (!signal || signal.aborted) return;
    setPaging(true);
    try {
      const page = await runtime<Detail>('/runs/' + encodeURIComponent(runId) + '?logs=1&beforeEvent=' + next.event
        + '&beforeTool=' + next.tool, signal);
      if (signal.aborted) return;
      setOlder(existing => [...existing, ...(page.logs ?? [])]);
      setCursor(page.next ?? {event:0, tool:0});
      setError(false);
    } catch { if (!signal.aborted) setError(true); }
    finally { setPaging(false); }
  }
  const original = [...older, ...(current?.logs ?? [])];
  const events: TimelineEvent[] = current ? original.map(entry => {
    const recorded = entry as RuntimeEvent;
    return {id: 'runtime:' + entry.id, time:entry.at, step:title(entry.step_id ?? entry.status ?? 'workflow'),
      source:entry.kind === 'tool' ? 'Runtime tool' : entry.kind === 'provider' ? 'Runtime provider' : 'Runtime',
      severity:entry.level.toUpperCase(), status:entry.status, duration:recorded.duration_ms,
      result:recorded.evidence?.result ?? entry.message,
      why:recorded.evidence?.reason ?? entry.result_excerpt ?? entry.completion,
      trace:recorded.trace, verification:recorded.evidence?.verification,
      details:{outputs:recorded.evidence?.outputs, policy:recorded.evidence?.policy}};
  }) : [];
  return {run:current?.run, events, error, loading:Boolean(runId && !current && !error), canPage, paging, loadMore,
    retry: () => setRefresh(current => current + 1)};
}
