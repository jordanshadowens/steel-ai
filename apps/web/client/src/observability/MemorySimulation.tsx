import { useState } from 'react';
import { objectValue, RecordedTable } from './RunData';
import type { TimelineEvent } from './ExecutionTimeline';

function assess(samples: number[], expected: number, threshold: number) {
  const exceeded = samples.filter(sample => sample > threshold).length;
  const outcome = samples.length !== expected ? 'Insufficient data' : exceeded === expected ? 'Sustained breach'
    : exceeded === 0 ? 'Within threshold' : 'Breach not sustained';
  return { outcome, samples_above_threshold: exceeded };
}

export function MemorySimulation({event, events}: {event: TimelineEvent; events: TimelineEvent[]}) {
  const input = objectValue(event.details?.inputs) ? event.details.inputs : undefined;
  const result = objectValue(event.details?.outputs) ? event.details.outputs : undefined;
  const threshold = input?.threshold_percent;
  const expected = result?.expected_samples;
  const observed = result?.observed_samples;
  const refs = event.details?.evidence_references;
  const [selected, select] = useState(String(threshold ?? ''));
  const [comparison, setComparison] = useState<Record<string, unknown>>();
  if (event.step !== 'Assess memory' || typeof threshold !== 'number' || !Number.isFinite(threshold)
    || typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 1
    || !Array.isArray(refs) || (!refs.length && observed !== 0)) return null;
  const evidence = new Map<string, number>();
  let unavailable = false;
  for (const ref of refs) {
    const row = events.find(item => item.id === 'agent:' + ref);
    const output = row?.details?.outputs;
    if (!objectValue(output) || !Array.isArray(output.rows)) {
      unavailable = true;
      continue;
    }
    for (const sample of output.rows) {
      if (objectValue(sample) && typeof sample.timestamp === 'string' &&
        typeof sample.utilization_percent === 'number' && Number.isFinite(sample.utilization_percent)) {
        const previous = evidence.get(sample.timestamp);
        if (previous !== undefined && previous !== sample.utilization_percent) unavailable = true;
        evidence.set(sample.timestamp, sample.utilization_percent);
      } else {
        unavailable = true;
      }
    }
  }
  if (unavailable || (typeof observed === 'number' && evidence.size !== observed)) {
    return <RecordedTable value={{policy_check:'Unavailable. Load all linked evidence rows to verify this decision.'}} />;
  }
  const samples = [...evidence.values()];
  const policy = assess(samples, expected, threshold);
  const checked = typeof observed === 'number' && typeof result?.outcome === 'string';
  return <>
    {checked && <RecordedTable value={{
      policy_check: policy.outcome === result.outcome ? 'Matches recorded assessment' : 'Differs from recorded assessment',
      expected_samples: expected, observed_samples: observed, threshold_percent: threshold,
      recalculated_assessment: policy.outcome,
    }} />}
    <details>
      <summary>Simulate a threshold with these recorded samples</summary>
      <form className="obs-toolbar" onSubmit={submit => {
        submit.preventDefault();
        const value = Number(selected);
        if (!selected.trim() || !Number.isFinite(value)) return;
        setComparison({...assess(samples, expected, value), threshold_percent:value, expected_samples:expected,
          available_samples:samples.length});
      }}>
        <label>Threshold (%)<input type="number" step="any" required value={selected}
          onChange={change => {select(change.target.value); setComparison(undefined);}} /></label>
        <button type="submit" className="run-link">Simulate</button>
      </form>
      {comparison && <RecordedTable value={comparison} />}
    </details>
  </>;
}
