import { CheckField, NumberField, SelectField, TextField } from '../creator/fields';
import { CURRENCIES, fmtKind, setFmtKind, setSegKind } from './specEdit';
import type { FmtKind, SegKind, Segment } from './specEdit';

// One text/bind/page segment with its value format. Shared by sections and
// header/footer editors.
export function SegmentRow({ seg, update, allowPage, onDelete }: {
  seg: Segment;
  update: (fn: (s: Segment) => void) => void;
  allowPage: boolean;
  onDelete: () => void;
}) {
  const kinds: SegKind[] = allowPage ? ['text', 'bind', 'page-number', 'page-count'] : ['text', 'bind'];
  const kind: SegKind = seg.text !== undefined ? 'text' : seg.bind !== undefined ? 'bind' : seg.page === 'count' ? 'page-count' : 'page-number';
  return (
    <div className="seg-row">
      <SelectField
        label="Kind"
        value={kind}
        options={kinds.map((k) => ({ value: k, label: k }))}
        onChange={(v) => update((s) => setSegKind(s, v as SegKind))}
      />
      {kind === 'text' && (
        <TextField label="Text" value={seg.text ?? ''} onCommit={(v) => update((s) => { s.text = v; })} />
      )}
      {kind === 'bind' && (
        <>
          <TextField label="Data slot" placeholder="customer.name" value={seg.bind ?? ''} onCommit={(v) => update((s) => { s.bind = v; })} />
          <FormatEditor seg={seg} update={update} />
        </>
      )}
      {kind !== 'text' && kind !== 'bind' && <span className="status-line">page number/count</span>}
      <button type="button" className="btn" aria-label="Delete segment" onClick={onDelete}>
        ×
      </button>
    </div>
  );
}

export function FormatEditor({ seg, update }: { seg: Segment; update: (fn: (s: Segment) => void) => void }) {
  const kind = fmtKind(seg);
  const fmt = (seg.format ?? {}) as Record<string, Record<string, unknown>>;
  const setKind = (v: string) => update((s) => setFmtKind(s as Record<string, unknown>, v as FmtKind));
  const setProp = (prop: string, v: unknown) => update((s) => {
    const f = ((s.format ?? {}) as Record<string, Record<string, unknown>>)[kind] as Record<string, unknown> | undefined;
    if (f) f[prop] = v as never;
  });
  return (
    <div className="seg-row">
      <SelectField
        label="Format"
        value={kind}
        options={['none', 'number', 'currency', 'date', 'percent'].map((k) => ({ value: k, label: k }))}
        onChange={setKind}
      />
      {(kind === 'number' || kind === 'percent') && (
        <NumberField
          label="Decimals"
          min={0}
          value={fmt[kind]?.decimals as number | undefined}
          onCommit={(v) => setProp('decimals', v)}
        />
      )}
      {kind === 'number' && (
        <CheckField
          label="Grouping"
          checked={(fmt.number?.grouping as boolean | undefined) !== false}
          onChange={(v) => setProp('grouping', v)}
        />
      )}
      {kind === 'currency' && (
        <>
          <SelectField
            label="Code"
            value={String(fmt.currency?.code ?? 'USD')}
            options={CURRENCIES.map((c) => ({ value: c, label: c }))}
            onChange={(v) => setProp('code', v)}
          />
          <NumberField label="Decimals" min={0} value={fmt.currency?.decimals as number | undefined} onCommit={(v) => setProp('decimals', v)} />
        </>
      )}
      {kind === 'date' && (
        <SelectField
          label="Style"
          value={String(fmt.date?.to ?? 'iso')}
          options={[{ value: 'iso', label: 'iso' }, { value: 'us', label: 'us' }, { value: 'long', label: 'long' }]}
          onChange={(v) => setProp('to', v)}
        />
      )}
    </div>
  );
}
