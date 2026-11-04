// Pure steel-doc/1 spec operations. The editor commits through these so
// every structural edit is one undo entry and unit-testable.
import type { DocSpec } from '../api/contracts';

export const FONTS = ['Arial', 'Segoe UI', 'Times New Roman', 'Calibri', 'Courier New', 'Verdana', 'Georgia'];
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'CNY', 'INR', 'MXN', 'KRW', 'BRL'];
export const PRED_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'exists'];
export const SECTION_TYPES = ['heading', 'paragraph', 'kv', 'table', 'callout', 'list', 'rule'];

// Loose editor views over the wire contract. Sections/segments vary by
// type, so editors work in `any` and the server validator stays the judge.
export type Spec = DocSpec & { styles?: any; page?: any; header?: any; footer?: any; sections?: Section[] };
export type Section = { type?: string; [key: string]: any };
export type Segment = { text?: string; bind?: string; page?: string; format?: any; [key: string]: any };

export function blankSpec(): Spec {
  return {
    schema: 'steel-doc/1',
    template_id: 'new-template',
    version: 1,
    title: 'Untitled',
    page: { size: 'letter', orientation: 'portrait', margin_in: { top: 0.75, bottom: 0.75, left: 0.75, right: 0.75 } },
    styles: { font: 'Arial', size_pt: 11, heading_font: 'Arial', heading_color: '#14285A', text_color: '#000000', muted_color: '#555555', rule_color: '#999999', table_header_fill: '#E6E6E6', table_grid_color: '#5A5A5A' },
    header: null,
    footer: { segments: [{ text: 'Page ' }, { page: 'number' }, { text: ' of ' }, { page: 'count' }], align: 'center' },
    sections: [{ type: 'paragraph', segments: [{ text: '' }] }],
  };
}

export function blankSection(type: string): Section {
  if (type === 'heading') return { type, level: 1, segments: [{ text: '' }] };
  if (type === 'paragraph') return { type, segments: [{ text: '' }] };
  if (type === 'kv') return { type, rows: [{ label: '', segments: [{ text: '' }] }] };
  if (type === 'table') return { type, columns: [{ header: '', bind: '', width_in: 2 }], rows: { bind: '' }, repeat_header: true };
  if (type === 'callout') return { type, label: '', segments: [{ text: '' }] };
  if (type === 'list') return { type, style: 'bullet', items: [{ segments: [{ text: '' }] }] };
  return { type: 'rule' };
}

export function smartValue(text: string): unknown {
  const t = text.trim();
  if (t === '') return '';
  try {
    return JSON.parse(t);
  } catch {
    return text;
  }
}

export function fmtDisplay(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v) ?? '';
}

export type SegKind = 'text' | 'bind' | 'page-number' | 'page-count';

export function segKind(seg: Segment): SegKind {
  if (seg.text !== undefined) return 'text';
  if (seg.bind !== undefined) return 'bind';
  return seg.page === 'count' ? 'page-count' : 'page-number';
}

export function setSegKind(seg: Segment, kind: SegKind): void {
  const keep = seg.bind !== undefined ? seg.bind : '';
  delete seg.text;
  delete seg.bind;
  delete seg.format;
  delete seg.page;
  if (kind === 'text') seg.text = '';
  else if (kind === 'bind') seg.bind = keep;
  else seg.page = kind === 'page-count' ? 'count' : 'number';
}

export type FmtKind = 'none' | 'number' | 'currency' | 'date' | 'percent';

export function fmtKind(seg: Segment): FmtKind {
  const fmt = seg.format as Record<string, unknown> | undefined;
  if (!fmt) return 'none';
  if (fmt.number !== undefined) return 'number';
  if (fmt.currency !== undefined) return 'currency';
  if (fmt.date !== undefined) return 'date';
  if (fmt.percent !== undefined) return 'percent';
  return 'none';
}

export function setFmtKind(holder: Record<string, any>, kind: FmtKind): void {
  if (kind === 'none') delete holder.format;
  else if (kind === 'number') holder.format = { number: {} };
  else if (kind === 'currency') holder.format = { currency: { code: 'USD' } };
  else if (kind === 'date') holder.format = { date: { to: 'iso' } };
  else holder.format = { percent: {} };
}

export function moveSection(spec: Spec, i: number, dir: -1 | 1): boolean {
  const sections = spec.sections ?? [];
  const j = i + dir;
  if (j < 0 || j >= sections.length) return false;
  [sections[i], sections[j]] = [sections[j], sections[i]];
  return true;
}

export type CondMode = 'none' | 'single' | 'all' | 'any';

export function condMode(cond: unknown): CondMode {
  if (!cond) return 'none';
  if (Array.isArray((cond as { all?: unknown }).all)) return 'all';
  if (Array.isArray((cond as { any?: unknown }).any)) return 'any';
  return 'single';
}

export function setCondMode(section: Section, mode: CondMode): void {
  if (mode === 'none') delete section.if;
  else if (mode === 'single') section.if = { ref: '', op: 'eq' };
  else section.if = { [mode]: [{ ref: '', op: 'eq' }] };
}
