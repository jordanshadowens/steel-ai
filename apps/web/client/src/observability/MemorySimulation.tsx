import { useState } from 'react';
import { objectValue, RecordedTable } from './RunData';
import type { TimelineEvent } from './ExecutionTimeline';

export function MemorySimulation({event, events}: {event: TimelineEvent; events: TimelineEvent[]}) {
  const input = objectValue(event.details?.inputs) ? event.details.inputs : undefined;
  const result = objectValue(event.details?.outputs) ? event.details.outputs : undefined;
  const threshold = input?.threshold_percent;
  const expected = result?.expected_samples;
  const refs = event.details?.evidence_references;
  const [selected, select] = useState(String(threshold ?? ''));
  const [comparison, setComparison] = useState<Record<string, unknown>>();
  if (event.step !== 'Assess memory' || typeof threshold !== 'number' || typeof expected !== 'number'
    || expected < 1 || !Array.isArray(refs) || !refs.length) return null;
  const evidence = new Map<string, number>();
  for (const ref of refs) {
    const row = events.find(item => item.id === 'agent:' + ref);
    const output = row?.details?.outputs;
    if (!objectValue(output) || !Array.isArray(output.rows)) continue;
    for (const sample of output.rows) {
      if (objectValue(sample) && typeof sample.timestamp === 'string' &&
        typeof sample.utilization_percent === 'number' && Number.isFinite(sample.utilization_percent))
        evidence.set(sample.timestamp, sample.utilization_percent);
    }
  }
  return <details>
    <summary>Simulate a threshold with these recorded samples</summary>
    <form className="obs-toolbar" onSubmit={submit => {
      submit.preventDefault();
      const value = Number(selected);
      if (!selected.trim() || !Number.isFinite(value)) return;
      const exceeded = [...evidence.values()].filter(sample => sample > value).length;
      const outcome = evidence.size !== expected ? 'Insufficient data' : exceeded === expected ? 'Sustained breach'
        : exceeded === 0 ? 'Within threshold' : 'Breach not sustained';
      setComparison({outcome, threshold_percent:value, expected_samples:expected,
        available_samples:evidence.size, samples_above_threshold:exceeded,
        ...(value === threshold && evidence.size === expected && typeof result?.outcome === 'string'
          ? {recorded_outcome:result.outcome, matches_recorded_assessment:outcome === result.outcome} : {})});
    }}>
      <label>Threshold (%)<input type="number" step="any" required value={selected}
        onChange={change => {select(change.target.value); setComparison(undefined);}} /></label>
      <button type="submit" className="run-link">Simulate</button>
    </form>
    {comparison && <RecordedTable value={comparison} />}
  </details>;
}
