// Opt-in browser diagnostics. Never log Request/Response objects or bodies.
export function withRequestTracing(
  fetcher: typeof fetch,
  enabled = () => import.meta.env.VITE_STEEL_TRACE_ENABLED === '1',
): typeof fetch {
  return async (input, init) => {
    if (!enabled()) {
      return fetcher(input, init);
    }
    const request = new Request(input, init);
    if (new URL(request.url).origin !== window.location.origin) {
      return fetcher(input, init);
    }
    const hex = (length: number) =>
      Array.from(crypto.getRandomValues(new Uint8Array(length)), (n) =>
        n.toString(16).padStart(2, '0'),
      ).join('');
    const traceId = hex(16);
    const parent = `00-${traceId}-${hex(8)}-01`;
    const headers = new Headers(request.headers);
    headers.set('traceparent', parent);
    const started = performance.now();
    // A fixed label avoids leaking IDs, search terms or source in URLs.
    const path = new URL(request.url).pathname;
    const operation = path.startsWith('/api/workflows')
      ? 'workflow'
      : path.startsWith('/api/runs')
        ? 'run'
        : 'api';
    const log = (outcome: string, status?: number) => {
      try {
        console.info('[steel.trace]', {
          trace_id: traceId,
          operation,
          method: request.method,
          outcome,
          status,
          duration_ms: Math.round(performance.now() - started),
        });
      } catch {
        /* Diagnostics only. */
      }
    };
    try {
      const response = await fetcher(new Request(request, { headers }));
      log(response.ok ? 'ok' : 'error', response.status);
      return response;
    } catch (error) {
      log('network_error');
      throw error;
    }
  };
}
