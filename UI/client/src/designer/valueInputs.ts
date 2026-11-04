// Shared value parsing for Data Designer forms. Mirrors the repository
// codec strictly (no silent coercion): integers must parse as integers,
// decimals/booleans pass through as exact strings/booleans, and the
// server remains the final validator — client errors are fast feedback,
// never the trust boundary.
import type { DesignerFtype } from '../api/contracts';

export type ParsedInput = { ok: true; value: unknown } | { ok: false; error: string };

export function parseScalarInput(ftype: DesignerFtype, text: string): ParsedInput {
  const t = text.trim();
  switch (ftype) {
    case 'integer': {
      if (!/^-?\d+$/.test(t)) return { ok: false, error: `not an integer: ${JSON.stringify(text)}` };
      const n = Number(t);
      if (!Number.isSafeInteger(n)) return { ok: false, error: 'integer out of safe range' };
      return { ok: true, value: n };
    }
    case 'boolean': {
      if (t === 'true') return { ok: true, value: true };
      if (t === 'false') return { ok: true, value: false };
      return { ok: false, error: 'boolean wants true or false' };
    }
    default:
      return { ok: true, value: text };
  }
}

export function formatScalarValue(ftype: DesignerFtype, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (ftype === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  return String(value);
}

export function parseRepeatedInput(ftype: DesignerFtype, text: string): ParsedInput {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const values: unknown[] = [];
  for (const line of lines) {
    const p = parseScalarInput(ftype, line);
    if (!p.ok) return p;
    values.push(p.value);
  }
  return { ok: true, value: values };
}

// RTK Query error shapes -> one readable line. Server {error} bodies win;
// transport errors fall back to status text.
export function apiMessage(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error && !('status' in (err as object))) return err.message;
  const e = err as { status?: unknown; data?: unknown; error?: unknown; message?: unknown };
  const data = e.data as { error?: unknown } | undefined;
  if (data && typeof data.error === 'string') return data.error;
  if (typeof e.error === 'string') return e.error;
  if (typeof e.message === 'string') return e.message;
  if (e.status !== undefined) return `request failed (status ${String(e.status)})`;
  return 'request failed';
}

export function isUnavailable(err: unknown): boolean {
  return (err as { status?: unknown })?.status === 501;
}
