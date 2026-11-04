import { describe, expect, it } from 'vitest';
import { apiMessage } from './CommandBar';

describe('apiMessage (batch10 structured errors)', () => {
  it('surfaces the validation errors array instead of generic Request failed', () => {
    expect(apiMessage({ status: 400, data: { ok: false, errors: ['steps[0].start.config.fields: "item" is not a declared input'] } }))
      .toBe('steps[0].start.config.fields: "item" is not a declared input');
  });
  it('shows the first two errors and counts the rest', () => {
    expect(apiMessage({ status: 400, data: { ok: false, errors: ['a', 'b', 'c', 'd'] } }))
      .toBe('a b (+2 more — click Validate for the full list)');
  });
  it('keeps single-error and legacy shapes unchanged', () => {
    expect(apiMessage({ status: 409, data: { error: 'already exists' } })).toBe('already exists');
    expect(apiMessage(new Error('Offline'))).toBe('Offline');
    expect(apiMessage({ status: 400, data: { ok: false, errors: [] } })).toBe('Request failed.');
    expect(apiMessage(null)).toBe('Request failed.');
  });
});
