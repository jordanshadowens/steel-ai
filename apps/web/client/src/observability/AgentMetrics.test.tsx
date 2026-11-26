import {cleanup, fireEvent, render, screen, within} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {AgentMetrics} from './AgentMetrics';

const {readMetrics} = vi.hoisted(() => ({readMetrics:vi.fn()}));
vi.mock('./cloud', () => ({runtime:readMetrics}));
vi.mock('./agentActivityApi', () => ({useListAgentRunsQuery:() => ({currentData:{agents:[]}})}));

afterEach(() => {
  cleanup();
  readMetrics.mockReset();
});

it('shows waiting and missing finishes outside the terminal rates and requests an aligned comparison', async () => {
  const security = {agentId:'security', name:'Security Agent', observed:5, terminal:2, waiting:1, unfinished:2,
    succeeded:1, failed:1, cancelled:0, eligible:2, verifiedSuccess:0, verified:1, retried:0,
    tools:5, toolFailures:1, durationCount:2, average:25, p50:20, p95:30, p99:30};
  const deployment = {agentId:'deployment', name:'Deployment Agent', unavailable:true};
  const base = {start:'2026-11-26T18:00:00Z', end:'2026-11-27T00:00:00Z', agents:[security,deployment]};
  readMetrics.mockImplementation(async (path: string) => path.includes('compare=1') ? {...base,
    previous:{start:'2026-11-26T12:00:00Z', end:base.start, agents:[{...security,observed:3,partial:true}]} } : base);
  render(<AgentMetrics />);
  const table = within(screen.getByRole('table',{name:'Agent execution metrics'}));
  const row = await table.findByRole('row',{name:/Security Agent/});
  const cells = within(row).getAllByRole('cell').map(cell => cell.textContent);
  expect(cells.slice(1,5)).toEqual(['5','2','1','2']);
  expect(cells).toContain('50.0% (1/2)');
  expect(cells).toContain('20.0% (1/5)');
  expect(table.getByText('Log source unavailable')).toBeTruthy();

  fireEvent.click(screen.getByLabelText('Compare prior window'));
  const comparison = within(screen.getByRole('table',{name:'Prior window comparison'}));
  expect(await comparison.findByText('3 (partial)')).toBeTruthy();
  expect(readMetrics.mock.calls.map(([path]) => path)).toEqual([
    '/observability/agent-runs/metrics?hours=6',
    '/observability/agent-runs/metrics?hours=6&compare=1',
  ]);
});
