import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ExecutionTimeline, type TimelineEvent } from './ExecutionTimeline';

afterEach(cleanup);

it('replays a stable chronological snapshot and leaves later checkpoints in the timeline', () => {
  const first: TimelineEvent = {id:'1',time:'2026-11-26T23:00:00Z',step:'Read inputs',source:'Runtime',severity:'INFO'};
  const last: TimelineEvent = {id:'2',time:'2026-11-26T23:00:01Z',step:'Check outcome',source:'Runtime',severity:'INFO',
    details:{observed:'Recorded result'}};
  const fresh: TimelineEvent = {id:'3',time:'2026-11-26T23:00:02Z',step:'Write receipt',source:'Agent',severity:'INFO'};
  const {rerender} = render(<ExecutionTimeline events={[last,first]} replayEnabled />);
  fireEvent.click(screen.getByRole('button',{name:'Replay loaded events'}));
  const timeline = within(screen.getByRole('table',{name:'Execution timeline'}));
  expect(timeline.getByRole('button',{name:'Read inputs'})).toBeTruthy();
  expect(timeline.queryByRole('button',{name:'Check outcome'})).toBeNull();
  expect(screen.getByRole('status').textContent).toBe('Event 1 of 2');
  rerender(<ExecutionTimeline events={[fresh,last,first]} replayEnabled />);
  fireEvent.click(screen.getByRole('button',{name:'Next event'}));
  expect(screen.getByRole('status').textContent).toBe('Event 2 of 2');
  expect(timeline.getByText('Recorded result')).toBeTruthy();
  expect(timeline.queryByRole('button',{name:'Write receipt'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Exit replay'}));
  expect(timeline.getByRole('button',{name:'Write receipt'})).toBeTruthy();
});
