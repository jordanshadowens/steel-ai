import { test, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RunMonitor } from './RunMonitor';

vi.mock('../api/steelApi', () => ({
  useGetRunQuery: () => ({ data: { run: { status: 'pending_approval' } } }),
}));
vi.mock('./ApprovalsInbox', () => ({ ApprovalsInbox: () => null }));

test('first-run approval is not described as running', () => {
  try {
    render(<RunMonitor runId="test" onTerminal={() => {}} />);
    expect(screen.getByText('Waiting for execution approval…')).toBeTruthy();
    expect(screen.queryByText('Running…')).toBeNull();
  } finally {
    cleanup();
  }
});
