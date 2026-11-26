import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentEvaluations } from './AgentEvaluations';

const {readDecisions, readRuntime} = vi.hoisted(() => ({readDecisions:vi.fn(),readRuntime:vi.fn()}));
vi.mock('./agentActivityApi', () => ({
  useListAgentRunsQuery:() => ({currentData:{agents:[{id:'incident-triage',name:'Incident Triage'}]}}),
  useGetAgentDecisionsQuery:readDecisions,
}));
vi.mock('./cloud', () => ({runtime:readRuntime}));
afterEach(() => {cleanup(); vi.resetAllMocks();});

it('checks the evidence automatically and keeps recorded skill comparisons and outcomes available', async () => {
  const at = '2026-11-26T23:00:00Z';
  const decision = {id:'decision',step:'assess_memory',eventType:'decision.made', executionId:'incident-1',
    timestamp:at,severity:'INFO',inputs:{threshold_percent:90}, outputs:{expected_samples:2,observed_samples:1,outcome:'Insufficient data'},
    evidenceRefs:['memory'], reason:'Received one of two expected samples.'};
  const memory = {id:'memory',step:'read_memory_samples',eventType:'evidence.collected',executionId:'incident-1',
    timestamp:at,severity:'INFO',outputs:{rows:[{timestamp:at,utilization_percent:50}]}};
  readDecisions.mockImplementation((_options, {skip}) => skip ? {} :
    {currentData:{steps:[decision],evidence:[memory],nextPageToken:'more'}});
  readRuntime.mockImplementation(async (path: string) => path === '/skills/observability'
    ? {skills:[{skill_id:1,name:'Inspect input',version:2,prior_checks:4,prior_passed:2,current_checks:4,current_passed:3}]}
    : {steps:[{id:'finished',executionId:'incident-1',timestamp:at,verification:{status:'unverified',method:'Recorded checks'}}]});
  const open = vi.fn();
  render(<AgentEvaluations openExecution={open} />);
  fireEvent.change(screen.getByLabelText('Agent'), {target:{value:'incident-triage'}});
  const checks = within(screen.getByRole('table',{name:'Recorded decision checks'}));
  expect(checks.getByText('Matches recorded assessment')).toBeTruthy();
  expect(checks.getByText('Received one of two expected samples.')).toBeTruthy();
  fireEvent.click(checks.getByRole('button',{name:'incident-1'}));
  expect(open).toHaveBeenCalledWith('incident-triage','incident-1');
  fireEvent.click(screen.getByRole('button',{name:'Older decisions'}));
  expect(readDecisions).toHaveBeenLastCalledWith({agent:'incident-triage',pageToken:'more'},{skip:false});
  expect(await within(screen.getByRole('table',{name:'Verified skill history'})).findByText('+25 pp')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Outcome verification'}));
  expect(await within(screen.getByRole('table',{name:'Recorded evaluations'})).findByText('Unverified')).toBeTruthy();
});
