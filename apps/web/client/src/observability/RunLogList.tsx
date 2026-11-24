import { useEffect, useRef } from 'react';
import { logLevels, type Entry } from './cloud';
import './run-logs.css';

export type MinimumSeverity = typeof logLevels[number];

export function SeverityFilter({value, onChange}: {value: MinimumSeverity; onChange: (level: MinimumSeverity) => void}) {
  return <label>Minimum severity <select value={value} onChange={event => onChange(event.target.value as MinimumSeverity)}>
    {logLevels.map((level, rank) => <option key={level} value={level}>
      {rank} · {level === 'fatal' ? 'FATAL / CRITICAL' : level.toUpperCase()}
    </option>)}
  </select></label>;
}

export function RunLogList({entries, following, newestFirst = false, selected, inspect}: {
  entries: Entry[];
  following: boolean;
  newestFirst?: boolean;
  selected?: string;
  inspect?: (entry: Entry) => void;
}) {
  const viewport = useRef<HTMLUListElement>(null);
  const latest = entries.at(newestFirst ? 0 : -1)?.id;
  useEffect(() => {
    const list = viewport.current;
    if (following && list) list.scrollTop = newestFirst ? 0 : list.scrollHeight;
  }, [following, latest, newestFirst, entries.length]);

  return <ul ref={viewport} className="run-logs shared-run-logs" aria-label="Run logs" tabIndex={0}>
    {entries.map(entry => {
      const message = <>{entry.kind === 'provider' && <strong>Provider · </strong>}{entry.message}
        {entry.completion && <small className="run-log-completion">{entry.completion}</small>}</>;
      return <li key={entry.id}>
        <time dateTime={entry.at}>{entry.at ? new Date(entry.at).toLocaleTimeString() : '—'}</time>
        <span data-level={entry.level}>{entry.level.toUpperCase()}</span>
        {inspect ? <button type="button" className="run-log-inspect" aria-expanded={String(entry.id) === selected}
          onClick={() => inspect(entry)}>{message}</button> : <span>{message}</span>}
      </li>;
    })}
    {!entries.length && <li>No matching log entries.</li>}
  </ul>;
}
