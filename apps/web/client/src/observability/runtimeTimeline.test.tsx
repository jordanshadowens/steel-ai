import {act, renderHook, waitFor} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import {useRuntimeTimeline} from './runtimeTimeline';

const {readRuntime} = vi.hoisted(() => ({readRuntime:vi.fn()}));
vi.mock('./cloud', () => ({runtime:readRuntime, terminal:() => true}));

it('reports measurement coverage and counts each provider response once across loaded pages', async () => {
  const run = {run_id:'fixture',workflow_id:'example',version:2,status:'sealed'};
  const completion = {id:'event-1',kind:'provider',status:'provider_completed',level:'info',message:'Provider finished'};
  const zero = {...completion,usage:{tokens:0}};
  const unmeasured = {...completion,id:'event-2'};
  const older = {...completion,id:'event-3',usage:{tokens:35}};
  const unrelated = {...completion,id:'event-4',status:'step_completed',usage:{tokens:95}};
  readRuntime.mockResolvedValueOnce({run,logs:[zero,unmeasured,unrelated],next:{event:1,tool:0}})
    .mockResolvedValueOnce({run,logs:[zero,older]});
  const {result, unmount} = renderHook(() => useRuntimeTimeline(run.run_id));
  await waitFor(() => expect(result.current.run?.run_id).toBe(run.run_id));
  expect(result.current.reportedTokens).toBe(0);
  expect(result.current.measuredProviderCompletions).toBe(1);
  expect(result.current.providerCompletions).toBe(2);
  expect(result.current.events.find(event => event.id === 'runtime:event-2')?.details)
    .toHaveProperty('reported_model_tokens','Unavailable');
  await act(() => result.current.loadMore());
  expect(result.current.reportedTokens).toBe(35);
  expect(result.current.measuredProviderCompletions).toBe(2);
  expect(result.current.providerCompletions).toBe(3);
  expect(result.current.events.filter(event => event.id === 'runtime:event-1')).toHaveLength(1);
  unmount();
});
