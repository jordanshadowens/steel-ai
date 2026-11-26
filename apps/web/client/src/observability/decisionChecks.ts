import { objectValue } from './RunData';
import type { TimelineEvent } from './ExecutionTimeline';

type Outcome = boolean | string;
type Simulation = {
  label: string;
  initial: number;
  min: number;
  max?: number;
  fractional?: boolean;
  replay: (value: number) => Record<string, unknown>;
};

export type DecisionCheck = {
  message: string;
  recorded?: Outcome;
  replayed?: Outcome;
  evidence?: Record<string, unknown>;
  simulation?: Simulation;
};

const unavailable = (reason: string, recorded?: Outcome): DecisionCheck => ({message:'Unavailable. ' + reason, recorded});

function comparison(label: string, recorded: Outcome | undefined, replayed: Outcome) {
  return recorded === undefined ? 'Unavailable. The recorded decision result is missing.'
    : (recorded === replayed ? 'Matches recorded ' : 'Differs from recorded ') + label;
}

function assess(samples: number[], expected: number, threshold: number) {
  const exceeded = samples.filter(sample => sample > threshold).length;
  const outcome = samples.length !== expected ? 'Insufficient data'
    : exceeded === expected ? 'Sustained breach' : exceeded === 0 ? 'Within threshold' : 'Breach not sustained';
  return {outcome, samples_above_threshold:exceeded};
}

function memoryDecision(event: TimelineEvent, events: readonly TimelineEvent[], input: Record<string, unknown>, result: Record<string, unknown>): DecisionCheck {
  const threshold = input.threshold_percent;
  const expected = result.expected_samples;
  const observed = result.observed_samples;
  const refs = event.details?.evidence_references;
  const recorded = typeof result.outcome === 'string' ? result.outcome : undefined;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold)
      || (input.comparator !== undefined && input.comparator !== '>')
      || typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 1
      || !Array.isArray(refs) || (!refs.length && observed !== 0)) {
    return unavailable('The alert policy or expected samples are missing.', recorded);
  }
  const evidence = new Map<number, number>();
  for (const ref of refs) {
    const row = events.find(item => item.id === 'agent:' + ref
      && (item.operation === 'read_memory_samples' || item.step === 'Read memory samples')
      && (!event.executionId || item.executionId === event.executionId)
      && (!event.trace || item.trace?.trace_id === event.trace.trace_id));
    const output = row?.details?.outputs;
    if (!objectValue(output) || !Array.isArray(output.rows))
      return unavailable('Load all linked evidence rows to verify this decision.', recorded);
    for (const sample of output.rows) {
      const timestamp = objectValue(sample) && typeof sample.timestamp === 'string' ? Date.parse(sample.timestamp) : NaN;
      const utilization = objectValue(sample) ? sample.utilization_percent : undefined;
      if (!Number.isFinite(timestamp) || typeof utilization !== 'number' || !Number.isFinite(utilization)
          || (evidence.has(timestamp) && evidence.get(timestamp) !== utilization)) {
        return unavailable('The linked samples are missing values or disagree for the same timestamp.', recorded);
      }
      evidence.set(timestamp, utilization);
    }
  }
  if (typeof observed === 'number' && evidence.size !== observed)
    return unavailable('Load all linked evidence rows to verify this decision.', recorded);
  const samples = [...evidence.values()];
  const replayed = assess(samples, expected, threshold).outcome;
  return {message:comparison('assessment', recorded, replayed), recorded, replayed,
    evidence:{expected_samples:expected, observed_samples:samples.length, threshold_percent:threshold,
      aggregation:input.aggregation, container:input.container},
    simulation:{label:'Memory threshold (%)', initial:threshold, min:0, max:100, fractional:true,
      replay:value => ({...assess(samples, expected, value), threshold_percent:value,
        expected_samples:expected, available_samples:samples.length})}};
}

export function evaluateDecision(event: TimelineEvent, evidence: readonly TimelineEvent[] = []): DecisionCheck | undefined {
  const operation = event.operation ?? (event.step === 'Assess memory' ? 'assess_memory' : undefined);
  if (event.eventType !== 'decision.made' && !(operation === 'assess_memory' && !event.eventType)) return undefined;
  const {inputs, outputs} = event.details ?? {};
  if (!objectValue(inputs) || !objectValue(outputs)) return unavailable('Decision inputs or results are missing.');

  if (operation === 'assess_memory') return memoryDecision(event, evidence, inputs, outputs);

  if (operation === 'verify_staging') {
    const endpoints = inputs.endpoint_http_status;
    const services = inputs.service_health;
    const expectedServices = ['steel-web-staging', 'steel-portal-staging'];
    const expectedEndpoints = ['/app/', '/cloud-runtime/api/runtime-config'];
    const recorded = typeof outputs.ready === 'boolean' ? outputs.ready : undefined;
    if (!objectValue(services) || !objectValue(endpoints)
        || !expectedServices.every(service => typeof services[service] === 'boolean')
        || !expectedEndpoints.every(endpoint => Number.isSafeInteger(endpoints[endpoint]))) {
      return unavailable('A serving-state or HTTP observation is missing.', recorded);
    }
    const ready = (status: number) => expectedServices.every(service => services[service] === true)
      && expectedEndpoints.every(endpoint => endpoints[endpoint] === status);
    const replayed = ready(200);
    return {message:comparison('readiness', recorded, replayed), recorded, replayed,
      evidence:{criteria:'Both services must be ready and both endpoints must return HTTP 200.',
        service_health:services, endpoint_http_status:endpoints},
      simulation:{label:'Required HTTP status', initial:200, min:100, max:599,
        replay:value => ({required_http_status:value, simulated_ready:ready(value)})}};
  }

  if (operation === 'decide_security_review') {
    const count = outputs.finding_count;
    const recorded = typeof outputs.review_recommended === 'boolean' ? outputs.review_recommended : undefined;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)
      return unavailable('The recorded finding count is missing.', recorded);
    const replayed = count > 0;
    return {message:comparison('review recommendation', recorded, replayed), recorded, replayed,
      evidence:{criteria:'Recommend review when an audited event matches a finding rule.',
        finding_count:count, events_reviewed:inputs.events_reviewed, recorded_coverage:outputs.coverage},
      simulation:{label:'Minimum matched findings', initial:1, min:1,
        replay:value => ({minimum_findings:value, recorded_findings:count, simulated_review_recommended:count >= value})}};
  }
  return unavailable('This decision has no deterministic replay rule.');
}
