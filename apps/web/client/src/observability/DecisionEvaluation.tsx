import { useState } from 'react';
import { RecordedTable } from './RunData';
import { evaluateDecision, type DecisionCheck } from './decisionChecks';
import type { TimelineEvent } from './ExecutionTimeline';

function DecisionSimulation({simulation}: {simulation: NonNullable<DecisionCheck['simulation']>}) {
  const [selected, setSelected] = useState(String(simulation.initial));
  const [output, setOutput] = useState<Record<string, unknown>>();
  return <details>
    <summary>Simulate with recorded evidence</summary>
    <form className="obs-toolbar" onSubmit={event => {
      event.preventDefault();
      const value = Number(selected);
      if (!selected.trim() || !Number.isFinite(value) || (!simulation.fractional && !Number.isSafeInteger(value))
          || value < simulation.min || (simulation.max !== undefined && value > simulation.max)) return;
      setOutput(simulation.replay(value));
    }}>
      <label>{simulation.label}<input type="number" step={simulation.fractional ? 'any' : 1}
        min={simulation.min} max={simulation.max} required value={selected}
        onChange={event => {setSelected(event.target.value); setOutput(undefined);}} /></label>
      <button type="submit" className="run-link">Simulate</button>
    </form>
    {output && <RecordedTable value={output} />}
  </details>;
}

export function DecisionEvaluation({event, events, check}: {
  event: TimelineEvent; events?: readonly TimelineEvent[]; check?: DecisionCheck;
}) {
  const result = check ?? evaluateDecision(event, events);
  if (!result) return null;
  return <>
    <RecordedTable value={{policy_check:result.message, recorded_decision:result.recorded,
      replayed_decision:result.replayed, ...result.evidence}} />
    {result.simulation && <DecisionSimulation key={event.id} simulation={result.simulation} />}
  </>;
}
