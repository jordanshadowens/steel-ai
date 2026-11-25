import { useEffect, useRef } from 'react';
import { logLevels, type Entry } from './cloud';
import './run-logs.css';

export type MinimumSeverity = Exclude<typeof logLevels[number], 'off'>;

export function SeverityFilter({value, onChange}: {value: MinimumSeverity; onChange: (level: MinimumSeverity) => void}) {
  return <label>Minimum severity <select value={value} onChange={event => onChange(event.target.value as MinimumSeverity)}>
    {logLevels.filter(level => level !== 'off').map(level => <option key={level} value={level}>
      {level === 'trace' ? 'All levels' : level === 'fatal' ? 'Fatal / Critical' : level.toUpperCase()}
    </option>)}
  </select></label>;
}

export function RunLogList({entries, following, newestFirst = false, selected, inspect, onLeaveTail}: {
  entries: Entry[];
  following: boolean;
  newestFirst?: boolean;
  selected?: string;
  inspect?: (entry: Entry) => void;
  onLeaveTail?: () => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const latest = entries.at(newestFirst ? 0 : -1)?.id;
  useEffect(() => {
    const list = viewport.current;
    if (following && list) list.scrollTop = newestFirst ? 0 : list.scrollHeight;
  }, [following, latest, newestFirst, entries.length]);

  return <div ref={viewport} className="run-logs shared-run-logs" role="region" aria-label="Scrollable run logs" tabIndex={0}
    onScroll={event => {
      if (!following || !onLeaveTail) return;
      const list = event.currentTarget;
      const distance = newestFirst ? list.scrollTop : list.scrollHeight - list.clientHeight - list.scrollTop;
      if (distance > 24) onLeaveTail();
    }}>
    <table aria-label="Run logs">
      <colgroup><col className="log-time-column" /><col className="log-level-column" /><col /></colgroup>
      <thead><tr><th scope="col">Timestamp</th><th scope="col">Severity</th><th scope="col">Event</th></tr></thead>
      <tbody>
    {entries.map(entry => {
      const message = <>{entry.kind === 'provider' && <strong>Provider · </strong>}{entry.message}
        {entry.completion && <small className="run-log-completion">{entry.completion}</small>}
        {entry.result_excerpt && <small className="run-log-completion"><strong>Conclusion</strong> {entry.result_excerpt}</small>}</>;
      return <tr key={entry.id}>
        <td><time dateTime={entry.at}>{entry.at ? new Date(entry.at).toLocaleTimeString() : '—'}</time></td>
        <td><span data-level={entry.level}>{entry.level.toUpperCase()}</span></td>
        <td>{inspect ? <button type="button" className="run-log-inspect" aria-haspopup="dialog" data-selected={String(entry.id) === selected}
          onClick={() => inspect(entry)}>{message}</button> : <span>{message}</span>}</td>
      </tr>;
    })}
    {!entries.length && <tr><td colSpan={3}>No matching log entries.</td></tr>}
      </tbody>
    </table>
  </div>;
}
