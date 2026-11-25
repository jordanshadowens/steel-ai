import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RunLogList, SeverityFilter } from './RunLogList';
import type { Entry } from './cloud';

afterEach(cleanup);

it('shows completion details and only follows the log when enabled', () => {
  const entries: Entry[] = [{id:1, level:'info', kind:'provider', message:'Meta completed', completion:'Produced step conclusion'}];
  const view = render(<RunLogList entries={entries} following={false} />);
  const list = screen.getByRole('region', {name:'Scrollable run logs'});
  Object.defineProperty(list, 'scrollHeight', {value:640});
  expect(screen.getByText('Produced step conclusion')).toBeTruthy();
  view.rerender(<RunLogList entries={entries} following={true} />);
  expect(list.scrollTop).toBe(640);
  list.scrollTop = 20;
  view.rerender(<RunLogList entries={[...entries, {id:2, level:'warn', message:'Provider throttled'}]} following={false} />);
  expect(list.scrollTop).toBe(20);
});

it('stops following when the reader scrolls away from the live edge', () => {
  const leaveTail = vi.fn();
  render(<RunLogList entries={[]} following onLeaveTail={leaveTail} />);
  const list = screen.getByRole('region', {name:'Scrollable run logs'});
  Object.defineProperties(list, {scrollHeight:{value:640}, clientHeight:{value:200}});
  list.scrollTop = 440;
  fireEvent.scroll(list);
  expect(leaveTail).not.toHaveBeenCalled();
  list.scrollTop = 240;
  fireEvent.scroll(list);
  expect(leaveTail).toHaveBeenCalledOnce();
});
it('offers severity filters without a provider logging toggle', () => {
  render(<SeverityFilter value="trace" onChange={() => {}} />);
  expect(screen.getByRole('option', {name:'All levels'})).toBeTruthy();
  expect(screen.getByRole('option', {name:'INFO'})).toBeTruthy();
  expect(screen.queryByRole('option', {name:/off/i})).toBeNull();
});
