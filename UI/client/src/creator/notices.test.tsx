import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NoticeProvider, useNotify } from './notices';

afterEach(() => { cleanup(); vi.useRealTimers(); });
it('deduplicates errors, dismisses after six seconds, and allows a later retry alert', () => {
  vi.useFakeTimers();
  function Trigger() {
    const notify = useNotify();
    return <button onClick={() => notify('error', 'Save failed. Click Save to retry.')}>Trigger</button>;
  }
  render(<NoticeProvider><Trigger /></NoticeProvider>);
  fireEvent.click(screen.getByText('Trigger')); fireEvent.click(screen.getByText('Trigger'));
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  act(() => { vi.advanceTimersByTime(6000); });
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByText('Trigger'));
  expect(screen.queryByRole('alert')).toBeNull();
  act(() => { vi.advanceTimersByTime(24000); });
  fireEvent.click(screen.getByText('Trigger'));
  expect(screen.getByRole('alert')).toBeTruthy();
});
