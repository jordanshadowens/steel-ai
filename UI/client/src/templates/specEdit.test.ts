import { describe, expect, it } from 'vitest';
import {
  blankSection,
  blankSpec,
  condMode,
  fmtKind,
  moveSection,
  segKind,
  setCondMode,
  setFmtKind,
  setSegKind,
  smartValue,
} from './specEdit';

describe('specEdit', () => {
  it('builds a valid blank spec skeleton', () => {
    const spec = blankSpec();
    expect(spec.schema).toBe('steel-doc/1');
    expect(spec.sections).toHaveLength(1);
    expect(spec.footer).not.toBeNull();
    expect(spec.header).toBeNull();
  });

  it('covers all seven section types', () => {
    for (const t of ['heading', 'paragraph', 'kv', 'table', 'callout', 'list', 'rule']) {
      expect(blankSection(t).type).toBe(t);
    }
    expect(blankSection('table').columns).toHaveLength(1);
  });

  it('switches segment kinds preserving the bind', () => {
    const seg = { bind: 'customer.name', format: { number: {} } };
    expect(segKind(seg)).toBe('bind');
    setSegKind(seg, 'text');
    expect(seg).toEqual({ text: '' });
    setSegKind(seg, 'bind');
    expect(seg.bind).toBe('');
    const seg2 = { bind: 'x' };
    setSegKind(seg2, 'page-count');
    expect(seg2).toEqual({ page: 'count' });
  });

  it('manages formats with currency/date defaults', () => {
    const holder: Record<string, unknown> = {};
    expect(fmtKind(holder)).toBe('none');
    setFmtKind(holder, 'currency');
    expect(holder).toEqual({ format: { currency: { code: 'USD' } } });
    expect(fmtKind(holder)).toBe('currency');
    setFmtKind(holder, 'none');
    expect(holder).toEqual({});
  });

  it('moves sections within bounds', () => {
    const spec = blankSpec();
    spec.sections = [{ type: 'paragraph' }, { type: 'rule' }];
    expect(moveSection(spec, 0, 1)).toBe(true);
    expect(spec.sections[0].type).toBe('rule');
    expect(moveSection(spec, 0, -1)).toBe(false);
  });

  it('detects and sets condition modes', () => {
    expect(condMode(undefined)).toBe('none');
    expect(condMode({ ref: 'a', op: 'exists' })).toBe('single');
    expect(condMode({ all: [] })).toBe('all');
    const s: Record<string, unknown> = {};
    setCondMode(s, 'any');
    expect(s).toEqual({ if: { any: [{ ref: '', op: 'eq' }] } });
    setCondMode(s, 'none');
    expect(s).toEqual({});
  });

  it('parses smart values preserving 0 and false', () => {
    expect(smartValue('0')).toBe(0);
    expect(smartValue('false')).toBe(false);
    expect(smartValue('')).toBe('');
    expect(smartValue('abc')).toBe('abc');
  });
});
