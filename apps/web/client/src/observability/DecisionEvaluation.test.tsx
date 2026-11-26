import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { DecisionEvaluation } from './DecisionEvaluation';
import type { TimelineEvent } from './ExecutionTimeline';

afterEach(cleanup);

it('evaluates readiness separately from a successful request and requires both observations', () => {
  const event: TimelineEvent = {
    id:'decision', step:'Verify staging', source:'Agent', severity:'INFO', operation:'verify_staging', eventType:'decision.made',
    details: {
      inputs: {service_health:{'steel-web-staging':true,'steel-portal-staging':true},
        endpoint_http_status:{'/app/':200,'/cloud-runtime/api/runtime-config':503}},
      outputs: {ready:true},
    },
  };
  const {rerender} = render(<DecisionEvaluation event={event} />);
  expect(screen.getByText('Differs from recorded readiness')).toBeTruthy();
  rerender(<DecisionEvaluation event={{...event, details:{inputs:{}, outputs:{ready:true}}}} />);
  expect(screen.getByText(/observation is missing/)).toBeTruthy();
});

it('compares the security recommendation against recorded findings and retains coverage', () => {
  render(<DecisionEvaluation event={{
    id:'decision', step:'Decide security review', source:'Agent', severity:'INFO',
    operation:'decide_security_review', eventType:'decision.made',
    details:{inputs:{events_reviewed:0},outputs:{finding_count:0,review_recommended:false,coverage:'no_matching_source_events'}},
  }} />);
  expect(screen.getByText('Matches recorded review recommendation')).toBeTruthy();
  expect(screen.getByText('no_matching_source_events')).toBeTruthy();
});

it('simulates an alternate audit threshold using the recorded finding count', () => {
  render(<DecisionEvaluation event={{
    id:'review-audit', step:'Decide security review', source:'Agent', severity:'INFO',
    operation:'decide_security_review', eventType:'decision.made',
    details:{inputs:{events_reviewed:4},outputs:{finding_count:3,review_recommended:true,coverage:'reviewed'}},
  }} />);
  fireEvent.change(screen.getByRole('spinbutton',{name:'Minimum matched findings'}),{target:{value:'4'}});
  fireEvent.click(screen.getByRole('button',{name:'Simulate'}));
  expect(screen.getByText('Simulated review recommended')).toBeTruthy();
  expect(screen.getByText('false')).toBeTruthy();
  expect(screen.getByText('Matches recorded review recommendation')).toBeTruthy();
});
