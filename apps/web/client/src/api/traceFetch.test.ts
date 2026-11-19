import { test, expect, vi } from 'vitest';
import { withRequestTracing } from './traceFetch';

test('browser diagnostics retain responses and correlate requests without logging credentials or source', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  let seen: Request | undefined;
  const response = new Response('{"ok":true}');
  const fetcher = vi.fn(async (input: any) => {
    seen = input;
    return response;
  });
  try {
    const result = await withRequestTracing(
      fetcher as any,
      () => true,
    )(
      new Request(window.location.origin + '/api/runs?secret=HIDDEN', {
        method: 'POST',
        headers: { authorization: 'Bearer HIDDEN' },
        body: 'PRIVATE_SOURCE',
      }),
    );
    expect(result).toBe(response);
    expect(seen?.headers.get('traceparent')).toMatch(
      /^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/,
    );
    expect(seen?.headers.get('authorization')).toBe('Bearer HIDDEN');
    expect(await seen?.text()).toBe('PRIVATE_SOURCE');
    expect(JSON.stringify(log.mock.calls)).not.toMatch(
      /HIDDEN|PRIVATE_SOURCE|authorization/,
    );
    expect(log.mock.calls[0][1]).toMatchObject({
      operation: 'run',
      status: 200,
      outcome: 'ok',
    });
  } finally {
    log.mockRestore();
  }
});
