import { checkpointEvent } from './ExecutionTimeline';
import { evaluateDecision } from './decisionChecks';
import { RecordedTable } from './RunData';
import type { DecisionPage } from './agentActivityApi';

export function evaluatedDecisions(page?: DecisionPage) {
  const evidence = (page?.evidence ?? []).map(checkpointEvent);
  return (page?.steps ?? []).map(checkpointEvent).map(event => ({event, check:evaluateDecision(event, evidence)}));
}

export function DecisionComparisonCell({page, error}: {page?: DecisionPage; error: boolean}) {
  if (error) return <>Decision log source unavailable.</>;
  if (!page) return <>Loading recorded decisions…</>;
  const rows = evaluatedDecisions(page);
  if (!rows.length) return <>No decisions recorded.</>;
  return <details>
    <summary>{rows.length}{page.nextPageToken ? '+' : ''} recorded {rows.length === 1 && !page.nextPageToken ? 'decision' : 'decisions'}</summary>
    <RecordedTable value={rows.map(({event, check}) => ({step:event.step, time:event.time, reason:event.why,
      recorded_decision:check?.recorded, replayed_decision:check?.replayed, policy_check:check?.message,
      evidence:check?.evidence}))} />
  </details>;
}
