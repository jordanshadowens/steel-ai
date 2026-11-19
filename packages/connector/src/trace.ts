// No private-runtime imports: connector diagnostics remain metadata-only.
export function validTraceparent(value) {
  return (
    typeof value === 'string' &&
    /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/.test(value) &&
    value.slice(3, 35) !== '0'.repeat(32) &&
    value.slice(36, 52) !== '0'.repeat(16)
  );
}
export function traceJob(job, event, outcome, duration_ms) {
  if (
    process.env.STEEL_TRACE_ENABLED !== '1' ||
    !validTraceparent(job?.traceparent)
  ) {
    return;
  }
  try {
    const row = {
      timestamp: new Date().toISOString(),
      service: 'steel-connector',
      event,
      trace_id: job.traceparent.slice(3, 35),
      parent_span_id: job.traceparent.slice(36, 52),
      outcome,
      duration_ms: Math.round(duration_ms),
    };
    console.info(JSON.stringify(row));
  } catch {
    /* Diagnostics never alter the provider outcome. */
  }
}
