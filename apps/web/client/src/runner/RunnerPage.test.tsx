import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { navigate, routeSearch } from '../app/router';
import { useListWorkflowsQuery } from '../api/steelApi';
import { RunnerPage } from './RunnerPage';

vi.mock('../app/router', () => ({
  routeSearch: vi.fn(() => new URLSearchParams('run=local-fixture')),
  routeHref: (route: string, query: URLSearchParams) => '/app/#/' + route + '?' + query,
  navigate: vi.fn(),
}));
vi.mock('../api/steelApi', () => ({
  useCreateRunMutation: () => [vi.fn(), {}],
  useGetWorkflowVersionsQuery: () => ({}),
  useListWorkflowsQuery: vi.fn(() => ({})),
  useGetRunQuery: () => ({
    currentData:{run:{run_id:'local-fixture',workflow_id:'meta-briefing-agent',version:1,status:'local_completed'}},
  }),
}));
vi.mock('./HistoryPanel', () => ({ HistoryPanel: () => <p>History sidebar</p> }));
vi.mock('./ApprovalsInbox', () => ({ ApprovalsInbox: () => <p>Approvals inbox</p> }));
vi.mock('./DocumentsPanel', () => ({ DocumentsPanel: () => <p>Documents panel</p> }));

test('opens a completed local run as a focused read-only detail', () => {
  render(<RunnerPage />);
  expect(screen.getByRole('heading', {name:'meta-briefing-agent'})).toBeTruthy();
  expect(screen.getByText('Completed')).toBeTruthy();
  expect(screen.getByRole('link', {name:'Inspect in Observability'}).getAttribute('href')).toContain('run=local-fixture');
  expect(screen.queryByLabelText('Workflow')).toBeNull();
  expect(screen.queryByText('Running…')).toBeNull();
  expect(screen.queryByText('Documents panel')).toBeNull();
});

test('points an empty workspace to Creator instead of showing an empty workflow selector', () => {
  vi.mocked(routeSearch).mockReturnValue(new URLSearchParams());
  vi.mocked(useListWorkflowsQuery).mockReturnValue({
    isSuccess: true,
    data: { workflows: [] },
    refetch: vi.fn(),
  } as ReturnType<typeof useListWorkflowsQuery>);

  render(<RunnerPage />);
  expect(screen.getByText('Publish a workflow in Creator to start a run.')).toBeTruthy();
  expect(screen.queryByLabelText('Workflow')).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Open Creator' }));
  expect(navigate).toHaveBeenCalledWith('creator');
});
