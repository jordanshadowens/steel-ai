import { useId } from 'react';
import type { GoldenSignals } from './agentActivityApi';
import { Timestamp } from './ExecutionTimeline';

const number = new Intl.NumberFormat(undefined, {maximumFractionDigits: 2});
const count = new Intl.NumberFormat();

function measurement(value: number | null, unit: string) {
  if (value === null) return 'Unavailable';
  return (value > 0 && value < 0.01 ? '<' + number.format(0.01) : number.format(value)) + unit;
}

const coverageLabel = {
  available: 'Complete coverage',
  partial: 'Partial coverage',
  unavailable: 'Unavailable',
} as const;

export function GoldenSignalsSummary({snapshot, live, loading, failed}: {
  snapshot?: GoldenSignals | null; live: boolean; loading: boolean; failed: boolean;
}) {
  const heading = useId();
  let content;
  if (!snapshot) {
    const status = failed || snapshot === null ? 'Unavailable' : live ? 'Collecting' : loading ? 'Loading' : 'Not recorded';
    content = <p className="obs-note" role="status">{status}</p>;
  } else if (snapshot.resource_status === 'unsupported') {
    content = <p className="obs-note">Unsupported resource. Golden signals require a Cloud Run revision.</p>;
  } else {
    const {latency, traffic, saturation, errors, expected_minutes: expected} = snapshot;
    const minutes = (observed: number) => `${observed} of ${expected} minutes`;
    const cards = [
      {title:'Latency', status:latency.status, coverage:minutes(latency.observed_minutes), values:[
        ['2xx peak 1-min p95', measurement(latency.ok_p95_ms, ' ms')],
        ['5xx peak 1-min p95', latency.error_p95_ms === null && errors.error_count === 0
          ? 'No 5xx observed' : measurement(latency.error_p95_ms, ' ms')],
      ]},
      {title:'Traffic', status:traffic.status, coverage:minutes(traffic.observed_minutes), values:[
        ['Average request rate', measurement(traffic.requests_per_second, ' req/s')],
        ['Observed requests', traffic.request_count === null ? 'Unavailable' : count.format(traffic.request_count)],
      ]},
      {title:'Saturation', status:saturation.status,
        coverage:`CPU ${minutes(saturation.cpu_observed_minutes)} · Memory ${minutes(saturation.memory_observed_minutes)}`,
        values:[['CPU peak 1-min p95', measurement(saturation.cpu_p95_percent, '%')],
          ['Memory peak 1-min p95', measurement(saturation.memory_p95_percent, '%')]]},
      {title:'Errors', status:errors.status, coverage:minutes(errors.observed_minutes), values:[
        ['HTTP 5xx share', measurement(errors.error_percent, '%')],
        ['Observed counts', errors.error_count === null || errors.request_count === null ? 'Unavailable'
          : `${count.format(errors.error_count)} of ${count.format(errors.request_count)} requests`],
      ]},
    ];
    content = <>
      <p className="obs-note golden-signals-context">
        <span>Revision {snapshot.revision ? <code>{snapshot.revision}</code> : 'unavailable'}</span>
        {snapshot.window_start && snapshot.window_end && <span>Window <Timestamp value={snapshot.window_start} />
          {' to '}<Timestamp value={snapshot.window_end} /></span>}
      </p>
      <div className="run-summary golden-signals-grid">
        {cards.map(card => <div key={card.title}>
          <h4>{card.title}</h4>
          <dl>{card.values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          <small>{coverageLabel[card.status]} · {card.coverage}</small>
        </div>)}
      </div>
    </>;
  }
  return <section className="golden-signals" aria-labelledby={heading}>
    <h3 id={heading}>Golden signals</h3>
    {content}
  </section>;
}
