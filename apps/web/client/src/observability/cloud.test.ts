import { expect, it } from 'vitest';
import { matchesSeverity, stepTimings, type Entry } from './cloud';

it('uses minimum severity and hides every level with Off', () => {
  const error: Entry = {id:'x', level:'error', message:'failed'};
  expect(matchesSeverity(error, 'warn')).toBe(true);
  expect(matchesSeverity(error, 'fatal')).toBe(false);
  expect(matchesSeverity({...error,level:'fatal'}, 'off')).toBe(false);
});

it('separates retry attempts, coexists with nested steps, and shows unfinished duration', () => {
  function event(id: number, step_id: string, status: string, at: number): Entry {
    return {id, step_id, status, at: new Date(at).toISOString(), level:'info', message:''};
  }
  expect(stepTimings([
    event(1,'parent','step_started',100),
    event(2,'child','step_started',200),
    event(3,'child','step_failed',300),
    event(4,'child','step_started',400),
    event(5,'child','step_completed',600),
    event(6,'parent','step_completed',700),
    event(7,'final','step_started',800),
  ], 950)).toEqual([
    {step:'parent',start:100,duration:600,status:'completed'},
    {step:'child',start:200,duration:100,status:'failed'},
    {step:'child',start:400,duration:200,status:'completed'},
    {step:'final',start:800,duration:150,status:'running'},
  ]);
});
