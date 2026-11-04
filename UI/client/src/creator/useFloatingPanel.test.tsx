import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { clampPanel, useFloatingPanel } from './useFloatingPanel';

vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
afterEach(cleanup);

it('keeps panels inside large and small canvases', () => {
  expect(clampPanel(900, -40, 320, 400, 1000, 700)).toEqual({ x: 672, y: 8 });
  expect(clampPanel(500, 500, 350, 350, 390, 500)).toEqual({ x: 32, y: 142 });
});

it('moves using the header keyboard and resets without handling child buttons', () => {
  function Panel() {
    const panel = useFloatingPanel();
    return <div><aside ref={panel.ref} style={panel.style} data-testid="panel"><div {...panel.handle}>Move<button>Close</button></div></aside></div>;
  }
  render(<Panel />);
  const panel = screen.getByTestId('panel');
  Object.defineProperties(panel, { offsetWidth: { value: 320 }, offsetHeight: { value: 300 }, offsetLeft: { value: 20 }, offsetTop: { value: 20 } });
  Object.defineProperties(panel.parentElement, { clientWidth: { value: 1000 }, clientHeight: { value: 700 } });
  const handle = screen.getByLabelText(/Move panel/);
  fireEvent.keyDown(handle, { key: 'ArrowRight' });
  expect(panel.style.left).toBe('36px');
  fireEvent.keyDown(screen.getByText('Close'), { key: 'Home' });
  expect(panel.style.left).toBe('36px');
  fireEvent.keyDown(handle, { key: 'Home' });
  expect(panel.style.left).toBe('');
});
