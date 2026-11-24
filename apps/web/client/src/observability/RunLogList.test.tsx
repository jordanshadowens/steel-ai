import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { RunLogList } from './RunLogList';
import type { Entry } from './cloud';

afterEach(cleanup);

it('shows completion details and only follows the log when enabled', () => {
  const entries: Entry[] = [{id:1, level:'info', kind:'provider', message:'Meta completed', completion:'Produced step conclusion'}];
  const view = render(<RunLogList entries={entries} following={false} />);
  const list = screen.getByRole('list', {name:'Run logs'});
  Object.defineProperty(list, 'scrollHeight', {value:640});
  expect(screen.getByText('Produced step conclusion')).toBeTruthy();
  view.rerender(<RunLogList entries={entries} following={true} />);
  expect(list.scrollTop).toBe(640);
  list.scrollTop = 20;
  view.rerender(<RunLogList entries={[...entries, {id:2, level:'warn', message:'Provider throttled'}]} following={false} />);
  expect(list.scrollTop).toBe(20);
});
