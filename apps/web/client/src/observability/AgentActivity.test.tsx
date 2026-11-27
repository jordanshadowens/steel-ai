import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentActivity } from './AgentActivity';

const {list, details, runtime} = vi.hoisted(() => ({list: vi.fn(), details: vi.fn(), runtime:vi.fn()}));
vi.mock('./agentActivityApi', () => ({useListAgentRunsQuery:list, useGetAgentStepsQuery:details}));
vi.mock('./runtimeTimeline', () => ({useRuntimeTimeline:runtime}));
afterEach(() => {cleanup(); vi.resetAllMocks();});

const at = '2026-01-02T03:04:05Z';
const security = {id:'security', name:'Security Agent', runs:[{id:'security-job-12', agentId:'security', timestamp:at, status:'succeeded'}]};
const triage = {id:'incident-triage', name:'Incident Triage', runs:[]};
const deploy = {id:'deployment', name:'Deployment Agent', sourceAvailable:false, runs:[]};
const selection = {agentId:'security', runId:'security-job-12'};

it('keeps agents visible during a partial outage and opens a table with evidence for the selected run', () => {
  list.mockReturnValue({currentData:{agents:[triage, security, deploy]}});
  runtime.mockReturnValue({events:[]});
  const select = vi.fn();
  const {rerender} = render(<AgentActivity select={select} openWorkflow={vi.fn()} />);
  expect(screen.getByRole('button', {name:'Incident Triage'})).toBeTruthy();
  expect(screen.getByText('Log source unavailable')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name:'Security Agent'}));
  expect(select).toHaveBeenCalledWith(selection);
  details.mockImplementation(({pageToken}: {pageToken?: string}) => ({currentData: pageToken
    ? {steps:[{id:'2',timestamp:at,step:'record_receipt',severity:'INFO',inputs:{},outputs:{issue:1}}]}
    : {steps:[{id:'1',timestamp:at,step:'read_audit_logs',severity:'INFO',inputs:{window:'15 minutes',password:'secret-test-value'},
      outputs:{events:3, reviewed:Array.from({length:70}, (_, index) => 'item-' + index)},reason:'Observed three matching events.'}],nextPageToken:'more'}}));
  rerender(<AgentActivity selected={selection} select={select} openWorkflow={vi.fn()} />);
  expect(screen.getByRole('table', {name:'Execution history'})).toBeTruthy();
  const timeline = screen.getByRole('table', {name:'Execution timeline'});
  expect(within(timeline).getByText('Observed three matching events.')).toBeTruthy();
  fireEvent.click(within(timeline).getByRole('button', {name:'Read audit logs'}));
  expect(within(timeline).getByText('15 minutes')).toBeTruthy();
  expect(within(timeline).getByText('[redacted]')).toBeTruthy();
  expect(screen.queryByText(/secret-test-value/)).toBeNull();
  expect(within(timeline).getByText('item-69')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name:'Load more steps'}));
  expect(within(timeline).getByRole('button', {name:'Record receipt'})).toBeTruthy();
  expect(details).toHaveBeenCalledWith(expect.objectContaining({agentId:'security',runId:'security-job-12',pageToken:'more'}), expect.anything());
});

it('combines linked Runtime events and keeps their original navigation', () => {
  const linked = {id:'inc-1', agentId:triage.id, timestamp:at, status:'succeeded', workflowRunId:'wf-run'};
  list.mockReturnValue({currentData:{agents:[{...triage, runs:[linked]}]}});
  details.mockReturnValue({currentData:{steps:[{id:'a',timestamp:at,step:'submit_workflow',severity:'INFO',inputs:{},outputs:{},
    trace:{trace_id:'trace',span_id:'submit'}}]}});
  runtime.mockReturnValue({events:[{id:'rt',time:'2026-01-02T03:04:06Z',step:'Runtime step',source:'Runtime',severity:'INFO',
    trace:{trace_id:'trace',span_id:'runtime',parent_span_id:'submit'}}]});
  const open = vi.fn();
  render(<AgentActivity selected={{agentId:triage.id, runId:'inc-1'}} select={vi.fn()} openWorkflow={open}/>);
  expect(within(screen.getByRole('table', {name:'Execution timeline'})).getByText('Runtime step')).toBeTruthy();
  expect(within(screen.getByRole('region', {name:'Golden signals'})).getByText('Not recorded')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name:'Span hierarchy'}));
  expect(within(screen.getByRole('table', {name:'Span hierarchy'})).getByText('Runtime step')).toBeTruthy();
  fireEvent.click(screen.getByRole('link', {name:'Open Steel workflow run'}));
  expect(open).toHaveBeenCalledWith('wf-run');
});

const snapshot = {
  resource_status:'supported', revision:'steel-api-00001-abc', expected_minutes:10,
  window_start:'2026-01-02T02:50:00Z', window_end:'2026-01-02T03:00:00Z',
  latency:{status:'partial', observed_minutes:8, ok_p95_ms:206, error_p95_ms:null},
  traffic:{status:'available', observed_minutes:10, requests_per_second:1, request_count:600},
  saturation:{status:'partial', cpu_observed_minutes:0, memory_observed_minutes:10, cpu_p95_percent:null, memory_p95_percent:42},
  errors:{status:'available', observed_minutes:10, error_percent:0, error_count:0, request_count:600},
};

it('shows the four scoped signal cards and preserves them as older steps load', () => {
  const run = {id:'inc-1', agentId:triage.id, timestamp:at, status:'succeeded'};
  list.mockReturnValue({currentData:{agents:[{...triage, runs:[run]}]}});
  runtime.mockReturnValue({events:[]});
  const step = (id: string, label: string) => ({id,timestamp:at,step:label,severity:'INFO',inputs:{},outputs:{}});
  details.mockImplementation(({pageToken}: {pageToken?: string}) => ({currentData: pageToken
    ? {steps:[step('b', 'read_metrics')]}
    : {steps:[step('a', 'accept_alert')], nextPageToken:'older', goldenSignals:snapshot}}));
  render(<AgentActivity selected={{agentId:triage.id,runId:run.id}} select={vi.fn()} openWorkflow={vi.fn()} />);
  const signals = within(screen.getByRole('region', {name:'Golden signals'}));
  expect(signals.getAllByRole('heading', {level:4}).map(heading => heading.textContent)).toEqual(['Latency','Traffic','Saturation','Errors']);
  expect(signals.getByText('steel-api-00001-abc')).toBeTruthy();
  expect(signals.getByText('Partial coverage · 8 of 10 minutes')).toBeTruthy();
  expect(signals.getByText('0%')).toBeTruthy();
  expect(signals.getByText('0 of 600 requests')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name:'Load more steps'}));
  expect(screen.getByRole('button', {name:'Read metrics'})).toBeTruthy();
  expect(signals.getByText('206 ms')).toBeTruthy();
});

it('distinguishes live collection, failed snapshot reads, and unsupported resources', () => {
  const run = {id:'inc-1', agentId:triage.id, timestamp:at, status:'started'};
  list.mockReturnValue({currentData:{agents:[{...triage, runs:[run]}]}});
  runtime.mockReturnValue({events:[]});
  details.mockReturnValue({currentData:{steps:[]}});
  const props = {selected:{agentId:triage.id, runId:run.id}, select:vi.fn(), openWorkflow:vi.fn()};
  const {rerender} = render(<AgentActivity {...props} />);
  const signals = within(screen.getByRole('region', {name:'Golden signals'}));
  expect(signals.getByRole('status').textContent).toBe('Collecting');
  details.mockReturnValue({currentData:{steps:[], goldenSignals:null}});
  rerender(<AgentActivity {...props} />);
  expect(signals.getByRole('status').textContent).toBe('Unavailable');
  details.mockReturnValue({currentData:{steps:[], goldenSignals:{...snapshot, resource_status:'unsupported'}}});
  rerender(<AgentActivity {...props} />);
  expect(signals.getByText(/Unsupported resource/)).toBeTruthy();
});

it('requests no traces when the account has no monitored agents or the list fails', () => {
  list.mockReturnValue({currentData:{agents:[]}});
  const props = {selected:selection, select:vi.fn(), openWorkflow:vi.fn()};
  const {rerender} = render(<AgentActivity {...props} />);
  expect(screen.getByText('No monitored agents for this workspace.')).toBeTruthy();
  expect(details).not.toHaveBeenCalled();
  list.mockReturnValue({isError:true, refetch:vi.fn()});
  rerender(<AgentActivity {...props} />);
  expect(screen.getByRole('alert').textContent).toContain('Could not refresh agent executions');
  expect(details).not.toHaveBeenCalled();
});
