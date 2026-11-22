import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

export function localDesigner(databaseUrl: string): Plugin {
  return {
    name: 'steel-local-designer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!/^\/api\/designer(?:\/|$)/.test(url.pathname)) {
          next();
          return;
        }
        const reply = (status: number, body: string) => {
          res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(body);
        };
        const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
        const host = req.headers.host ?? '';
        const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
        if (!localHost || !loopback.includes(req.socket.remoteAddress ?? '') ||
            req.headers['sec-fetch-site'] === 'cross-site' ||
            (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) {
          reply(403, '{"error":"Local Data Designer accepts same-origin loopback requests only."}');
          return;
        }
        try {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            const data = Buffer.from(chunk);
            size += data.length;
            if (size > 1024 * 1024) {
              reply(413, '{"error":"Request is too large."}');
              return;
            }
            chunks.push(data);
          }
          const body = size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
          const child = execFile(
            'python',
            [fileURLToPath(new URL('./designer_postgres.py', import.meta.url))],
            { env: { ...process.env, DATABASE_URL: databaseUrl }, timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
            (error, stdout) => {
              if (error) {
                reply(503, '{"error":"Local Data Designer unavailable. Check PostgreSQL and the Python dependencies."}');
                return;
              }
              try {
                const { status, data } = JSON.parse(stdout);
                reply(status, JSON.stringify(data));
              } catch {
                reply(503, '{"error":"Invalid response from local Data Designer."}');
              }
            },
          );
          child.stdin?.on('error', () => {});
          child.stdin?.end(JSON.stringify({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body }));
        } catch {
          reply(400, '{"error":"Invalid JSON request."}');
        }
      });
    },
  };
}
