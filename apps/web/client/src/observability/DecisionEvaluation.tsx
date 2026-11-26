import { objectValue, RecordedTable } from './RunData';
import type { TimelineEvent } from './ExecutionTimeline';

export function DecisionEvaluation({event}: {event: TimelineEvent}) {
  if (event.eventType !== 'decision.made') return null;
  const { inputs, outputs } = event.details ?? {};
  if (!objectValue(inputs) || !objectValue(outputs)) return null;

  if (event.operation === 'verify_staging') {
    const endpoints = inputs.endpoint_http_status;
    const services = inputs.service_health;
    const expectedServices = ['steel-web-staging', 'steel-portal-staging'];
    const expectedEndpoints = ['/app/', '/cloud-runtime/api/runtime-config'];
    if (typeof outputs.ready !== 'boolean' || !objectValue(services) || !objectValue(endpoints)
      || !expectedServices.every(service => typeof services[service] === 'boolean')
      || !expectedEndpoints.every(endpoint => Number.isSafeInteger(endpoints[endpoint]))) {
      return <RecordedTable value={{policy_check:'Unavailable. A serving-state or HTTP observation is missing.'}} />;
    }
    const ready = expectedServices.every(service => services[service] === true)
      && expectedEndpoints.every(endpoint => endpoints[endpoint] === 200);
    return <RecordedTable value={{
      policy_check: ready === outputs.ready ? 'Matches recorded readiness' : 'Differs from recorded readiness',
      criteria:'Both services must be ready and both endpoints must return HTTP 200.',
      reevaluated_readiness:ready,
    }} />;
  }

  if (event.operation === 'decide_security_review') {
    const count = outputs.finding_count;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0
      || typeof outputs.review_recommended !== 'boolean') {
      return <RecordedTable value={{policy_check:'Unavailable. The finding count or review decision is missing.'}} />;
    }
    const recommended = count > 0;
    return <RecordedTable value={{
      policy_check: recommended === outputs.review_recommended ? 'Matches recorded review recommendation' : 'Differs from recorded review recommendation',
      criteria:'Recommend review when an audited event matches a finding rule.',
      recorded_coverage:outputs.coverage,
      reevaluated_review_recommended:recommended,
    }} />;
  }
  return null;
}
