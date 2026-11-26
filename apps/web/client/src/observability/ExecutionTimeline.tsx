import { Fragment, useState } from 'react';
import { RecordedTable, approved, objectValue } from './RunData';
import { DecisionEvaluation } from './DecisionEvaluation';
import type { Checkpoint, Trace, Verification } from './agentActivityApi';

export const title = (value?: string) => value ? value.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase()) : 'Not recorded';
export const duration = (ms?: number) => ms === undefined ? 'Not recorded' : ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(1) + ' s';
export function Timestamp({value}: {value?: string}) {
  return value && Number.isFinite(Date.parse(value))
    ? <time dateTime={value}>{new Date(value).toLocaleString()}</time> : <>Not recorded</>;
}

export type TimelineEvent = {
  id: string; time?: string; step: string; source: string; severity: string;
  executionId?: string;
  operation?: string;
  eventType?: string;
  status?: string; duration?: number; result?: string; why?: string; trace?: Trace;
  links?: Trace[]; verification?: Verification; details?: Record<string, unknown>;
};

export function checkpointEvent(entry: Checkpoint): TimelineEvent {
  const output = objectValue(entry.outputs) ? entry.outputs : undefined;
  const result = output?.outcome ?? output?.status ?? (output?.ready !== undefined ? (output.ready ? 'Ready' : 'Readiness checks failed') : undefined);
  return {
    id: 'agent:' + entry.id, executionId:entry.executionId, time: entry.timestamp, step: title(entry.step), source: title(entry.source ?? 'agent'),
    operation: entry.step, eventType: entry.eventType,
    severity: entry.severity, status: entry.status, duration: entry.duration,
    result: typeof result === 'string' ? title(result) : undefined, why: entry.reason,
    trace: entry.trace, links: entry.spanLinks, verification: entry.verification,
    details: {inputs: entry.inputs, outputs: entry.outputs, attempt: entry.attempt, error: entry.error,
      evidence_references: entry.evidenceRefs},
  };
}

function spanKey(trace?: Trace) { return trace && trace.trace_id + '/' + trace.span_id; }

export function sortedEvents(entries: TimelineEvent[]) {
  return [...new Map(entries.map(event => [event.id, event])).values()].sort((left, right) =>
    (Date.parse(left.time || '') || 0) - (Date.parse(right.time || '') || 0) || left.id.localeCompare(right.id));
}

type SpanRow = {key: string; event: TimelineEvent; depth: number};
function spans(events: TimelineEvent[], collapsed: Set<string>) {
  const nodes = new Map<string, TimelineEvent>();
  for (const event of events) {
    const key = spanKey(event.trace);
    if (!key) continue;
    const previous = nodes.get(key);
    if (!previous || event.status !== 'heartbeat') nodes.set(key, {...event, time: previous?.time ?? event.time});
  }
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const [key, event] of nodes) {
    const parent = event.trace!.trace_id + '/' + event.trace!.parent_span_id;
    if (nodes.has(parent) && key !== parent) children.set(parent, [...(children.get(parent) ?? []), key]);
    else roots.push(key);
  }
  const rows: SpanRow[] = [];
  const seen = new Set<string>();
  function visit(key: string, depth: number) {
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({key, event: nodes.get(key)!, depth});
    for (const child of children.get(key) ?? []) {
      if (!collapsed.has(key)) visit(child, depth + 1);
    }
  }
  roots.forEach(key => visit(key, 0));
  return {rows, children};
}

export function ExecutionTimeline({events, loading, failed, retry, initialEvent, openExecution}: {
  events: TimelineEvent[]; loading?: boolean; failed?: boolean; retry?: () => void; initialEvent?: string;
  openExecution?: (executionId: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialEvent ? [initialEvent] : []));
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [showTrace, setShowTrace] = useState(false);
  const [filter, setFilter] = useState('');
  const [severity, setSeverity] = useState('');
  const ordered = sortedEvents(events);
  const visible = ordered.filter(event => (!severity || event.severity === severity) &&
    [event.step, event.result, event.why, event.source].some(value => value?.toLowerCase().includes(filter.trim().toLowerCase())));
  const hierarchy = spans(ordered, collapsed);
  const toggle = (key: string, setter: typeof setExpanded) => setter(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  return <>
    <div className="obs-toolbar">
      <h3>Execution timeline</h3>
      <label>Find an event<input value={filter} onChange={event => setFilter(event.target.value)} /></label>
      <label>Severity<select value={severity} onChange={event => setSeverity(event.target.value)}>
        <option value="">All severities</option>{[...new Set(ordered.map(event => event.severity))].map(level =>
          <option key={level} value={level}>{level}</option>)}</select></label>
      <button type="button" className="run-link" aria-expanded={showTrace} onClick={() => setShowTrace(value => !value)}>Span hierarchy</button>
    </div>
    {showTrace && <div className="run-table-viewport" role="region" aria-label="Span hierarchy" tabIndex={0}>
      <table className="run-table" aria-label="Span hierarchy"><thead><tr><th scope="col">Operation</th><th scope="col">Source</th>
        <th scope="col">Span</th><th scope="col">Parent span</th><th scope="col">Status</th></tr></thead>
        <tbody>{hierarchy.rows.map(({key, event, depth}) => <tr key={key}>
          <td style={{paddingInlineStart: 12 + Math.min(depth, 12) * 16}}>
            {hierarchy.children.has(key) ? <button type="button" className="run-row-button" aria-expanded={!collapsed.has(key)}
              onClick={() => toggle(key, setCollapsed)}>{event.step}</button> : event.step}</td>
          <td>{event.source}</td><td><code>{event.trace?.span_id}</code></td>
          <td>{event.trace?.parent_span_id ? <code>{event.trace.parent_span_id}</code> : 'Root'}</td><td>{title(event.status)}</td>
        </tr>)}
        {!hierarchy.rows.length && <tr><td colSpan={5}>Span relationships were not recorded.</td></tr>}</tbody>
      </table>
    </div>}
    <div className="run-table-viewport obs-timeline" role="region" aria-label="Execution timeline" tabIndex={0}>
      <table className="run-table" aria-label="Execution timeline">
        <thead><tr>{['Time', 'Step', 'Source', 'Severity', 'Status', 'Duration', 'Result', 'Why'].map(column =>
          <th key={column} scope="col">{column}</th>)}</tr></thead>
        <tbody>{visible.map(event => <Fragment key={event.id}>
          <tr><td><Timestamp value={event.time} /></td>
            <td><button type="button" className="run-row-button" aria-expanded={expanded.has(event.id)}
              onClick={() => toggle(event.id, setExpanded)}>{event.step}</button></td>
            <td>{event.source}</td><td>{event.severity}</td><td>{title(event.status)}</td><td>{duration(event.duration)}</td>
            <td>{event.result ?? 'Not recorded'}</td><td>{event.why ?? 'Not recorded'}</td></tr>
          {expanded.has(event.id) && <tr className="obs-evidence"><td colSpan={8}>
            {event.executionId && openExecution && <button type="button" className="run-link"
              onClick={() => openExecution(event.executionId!)}>Open execution</button>}
            <RecordedTable value={{...event.details, verification:event.verification, trace:event.trace, span_links:event.links}} />
            <DecisionEvaluation event={event} events={ordered} />
            <details><summary>View redacted event data</summary>
              <pre>{JSON.stringify(approved(event), null, 2)}</pre></details>
          </td></tr>}
        </Fragment>)}
        {loading && <tr><td colSpan={8} role="status">Loading execution events…</td></tr>}
        {failed && <tr><td colSpan={8} role="alert">Could not load execution events. {retry &&
          <button type="button" className="run-link" onClick={retry}>Retry</button>}</td></tr>}
        {!visible.length && !loading && !failed && <tr><td colSpan={8}>
          {ordered.length ? 'No matching events in this page.' : 'No events recorded.'}</td></tr>}</tbody>
      </table>
    </div>
  </>;
}
