import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { MemorySimulation } from './MemorySimulation';
import type { TimelineEvent } from './ExecutionTimeline';

afterEach(cleanup);

it('evaluates only the evidence linked to the decision', () => {
  const decision: TimelineEvent = {
    id:'agent:decision', step:'Assess memory', severity:'INFO', source:'Agent',
    details:{inputs:{threshold_percent:90}, outputs:{expected_samples:2}, evidence_references:['evidence']},
  };
  const evidence: TimelineEvent = {
    id:'agent:evidence', step:'Read memory samples', severity:'INFO', source:'Agent',
    details:{outputs:{rows:[
      {timestamp:'2026-01-01T00:00:00Z', utilization_percent:94},
      {timestamp:'2026-01-01T00:01:00Z', utilization_percent:95},
    ]}},
  };
  render(<MemorySimulation event={decision} events={[evidence]} />);
  fireEvent.change(screen.getByRole('spinbutton'), {target:{value:'94'}});
  fireEvent.click(screen.getByRole('button', {name:'Simulate'}));
  expect(screen.getByText('Breach not sustained')).toBeTruthy();
});

it('checks an assessment against its recorded policy and samples before simulating', () => {
  const decision: TimelineEvent = {
    id:'agent:decision', step:'Assess memory', severity:'INFO', source:'Agent',
    details:{inputs:{threshold_percent:90}, outputs:{expected_samples:2, observed_samples:2, outcome:'Sustained breach'},
      evidence_references:['evidence']},
  };
  const evidence: TimelineEvent = {
    id:'agent:evidence', step:'Read memory samples', severity:'INFO', source:'Agent',
    details:{outputs:{rows:[
      {timestamp:'2026-01-01T00:00:00Z', utilization_percent:90},
      {timestamp:'2026-01-01T00:01:00Z', utilization_percent:95},
    ]}},
  };
  const { rerender } = render(<MemorySimulation event={decision} events={[evidence]} />);
  expect(screen.getByText('Differs from recorded assessment')).toBeTruthy();
  expect(screen.getByText('Breach not sustained')).toBeTruthy();
  rerender(<MemorySimulation event={decision} events={[]} />);
  expect(screen.getByText(/load all linked evidence rows/i)).toBeTruthy();
  expect(screen.queryByRole('button', {name:'Simulate'})).toBeNull();
});
