import { CheckField, NumberField, SelectField, TextField } from '../creator/fields';
import { FormatEditor, SegmentRow } from './SegmentEditor';
import { PRED_OPS, condMode, fmtDisplay, setCondMode, smartValue } from './specEdit';
import type { Section, Segment, Spec } from './specEdit';

export type SpecEditFn = (fn: (spec: Spec) => void) => void;

function atSections(edit: SpecEditFn, i: number, fn: (s: Section) => void): void {
  edit((spec) => {
    const s = spec.sections?.[i] as Section | undefined;
    if (s) fn(s);
  });
}

// Section frame with reorder (buttons, the accessible alternative to
// dragging) and delete. Children are the per-type editors.
export function SectionFrame({ index, total, onMove, onDelete, children }: {
  index: number;
  total: number;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  return (
    <details className="section-block" open>
      <summary>Section {index + 1} of {total}</summary>
      {children}
      <div className="toolbar">
        <button type="button" className="btn" disabled={index === 0} aria-label={`Move section ${index + 1} up`} onClick={() => onMove(-1)}>↑</button>
        <button type="button" className="btn" disabled={index === total - 1} aria-label={`Move section ${index + 1} down`} onClick={() => onMove(1)}>↓</button>
        <button type="button" className="btn btn-danger" onClick={onDelete}>Delete section</button>
      </div>
    </details>
  );
}

function SegList({ segs, onUpdate, onDelete, onAdd }: {
  segs: Segment[];
  onUpdate: (j: number) => (fn: (s: Segment) => void) => void;
  onDelete: (j: number) => void;
  onAdd: () => void;
}) {
  return (
    <div>
      {(segs ?? []).map((g, j) => (
        <SegmentRow key={j} seg={g} update={onUpdate(j)} allowPage={false} onDelete={() => onDelete(j)} />
      ))}
      <button type="button" className="btn" onClick={onAdd}>
        Add segment
      </button>
    </div>
  );
}

function segListProps(edit: SpecEditFn, i: number, get: (s: Section) => Segment[] | undefined, ensure: (s: Section) => Segment[]) {
  return {
    onUpdate: (j: number) => (fn: (s: Segment) => void) => atSections(edit, i, (s) => {
      const list = ensure(s);
      if (list[j]) fn(list[j]);
    }),
    onDelete: (j: number) => atSections(edit, i, (s) => {
      ensure(s).splice(j, 1);
    }),
    onAdd: () => atSections(edit, i, (s) => {
      ensure(s).push({ text: '' });
    }),
  };
}

export function HeadingEditor({ section, index, edit }: { section: Section; index: number; edit: SpecEditFn }) {
  return (
    <div>
      <SelectField
        label="Level"
        value={String(section.level ?? 1)}
        options={[{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }]}
        onChange={(v) => atSections(edit, index, (s) => { s.level = Number(v); })}
      />
      <SegList
        segs={section.segments ?? []}
        {...segListProps(edit, index, (s) => s.segments, (s) => (s.segments = s.segments ?? []))}
      />
      <ConditionEditor section={section} index={index} edit={edit} />
    </div>
  );
}

export function ParagraphEditor({ section, index, edit }: { section: Section; index: number; edit: SpecEditFn }) {
  return (
    <div>
      <SelectField
        label="Align"
        value={section.align ?? 'left'}
        options={[{ value: 'left', label: 'left' }, { value: 'center', label: 'center' }, { value: 'right', label: 'right' }]}
        onChange={(v) => atSections(edit, index, (s) => { s.align = v; })}
      />
      <SegList
        segs={section.segments ?? []}
        {...segListProps(edit, index, (s) => s.segments, (s) => (s.segments = s.segments ?? []))}
      />
      <ConditionEditor section={section} index={index} edit={edit} />
    </div>
  );
}

export function KvEditor({ section, index, edit }: { section: Section; index: number; edit: SpecEditFn }) {
  return (
    <div>
      <TextField
        label="Title (optional)"
        value={section.title ?? ''}
        onCommit={(v) => atSections(edit, index, (s) => {
          if (v === '') delete s.title;
          else s.title = v;
        })}
      />
      <NumberField
        label="Label width (in)"
        min={1}
        value={section.label_width_in}
        onCommit={(v) => atSections(edit, index, (s) => { s.label_width_in = v; })}
      />
      {(section.rows ?? []).map((r: Section['rows'] extends Array<infer R> ? R : never, k: number) => (
        <div key={k} className="rule-block">
          <TextField
            label={`Row ${k + 1} label`}
            value={(r as { label?: string }).label ?? ''}
            onCommit={(v) => atSections(edit, index, (s) => {
              const row = (s.rows ?? [])[k] as { label?: string } | undefined;
              if (row) row.label = v;
            })}
          />
          {(((r as { segments?: Segment[] }).segments ?? [])).map((g, j) => (
            <SegmentRow
              key={j}
              seg={g}
              allowPage={false}
              update={(fn) => atSections(edit, index, (s) => {
                const list = ((s.rows ?? [])[k] as { segments?: Segment[] } | undefined)?.segments;
                if (list?.[j]) fn(list[j]);
              })}
              onDelete={() => atSections(edit, index, (s) => {
                (((s.rows ?? [])[k] as { segments?: Segment[] }).segments ?? []).splice(j, 1);
              })}
            />
          ))}
          <div className="toolbar">
            <button
              type="button"
              className="btn"
              onClick={() => atSections(edit, index, (s) => {
                const row = ((s.rows ?? [])[k] ?? {}) as { segments?: Segment[] };
                row.segments = row.segments ?? [];
                row.segments.push({ text: '' });
              })}
            >
              Add value segment
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => atSections(edit, index, (s) => { (s.rows ?? []).splice(k, 1); })}
            >
              Delete row
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn"
        onClick={() => atSections(edit, index, (s) => {
          s.rows = s.rows ?? [];
          s.rows.push({ label: '', segments: [{ text: '' }] });
        })}
      >
        Add row
      </button>
      <ConditionEditor section={section} index={index} edit={edit} />
    </div>
  );
}

export function TableEditor({ section, index, edit }: { section: Section; index: number; edit: SpecEditFn }) {
  return (
    <div>
      <TextField
        label="Title (optional)"
        value={section.title ?? ''}
        onCommit={(v) => atSections(edit, index, (s) => {
          if (v === '') delete s.title;
          else s.title = v;
        })}
      />
      <TextField
        label="Rows bind"
        placeholder="lines"
        value={(section.rows as { bind?: string } | undefined)?.bind ?? ''}
        onCommit={(v) => atSections(edit, index, (s) => { s.rows = { bind: v }; })}
      />
      <CheckField
        label="Repeat header on page breaks"
        checked={section.repeat_header !== false}
        onChange={(v) => atSections(edit, index, (s) => { s.repeat_header = v; })}
      />
      {(section.columns ?? []).map((c: Segment, k: number) => (
        <div key={k} className="rule-block">
          <div className="status-line num">Column {k + 1}</div>
          <TextField
            label="Header"
            value={(c as { header?: string }).header ?? ''}
            onCommit={(v) => atSections(edit, index, (s) => {
              const col = (s.columns ?? [])[k] as { header?: string } | undefined;
              if (col) col.header = v;
            })}
          />
          <TextField
            label="Field bind"
            value={(c as { bind?: string }).bind ?? ''}
            onCommit={(v) => atSections(edit, index, (s) => {
              const col = (s.columns ?? [])[k] as { bind?: string } | undefined;
              if (col) col.bind = v;
            })}
          />
          <NumberField
            label="Width (in)"
            min={0.5}
            value={(c as { width_in?: number }).width_in}
            onCommit={(v) => atSections(edit, index, (s) => {
              const col = (s.columns ?? [])[k] as { width_in?: number } | undefined;
              if (col) col.width_in = v;
            })}
          />
          <SelectField
            label="Align"
            value={(c as { align?: string }).align ?? 'left'}
            options={[{ value: 'left', label: 'left' }, { value: 'center', label: 'center' }, { value: 'right', label: 'right' }]}
            onChange={(v) => atSections(edit, index, (s) => {
              const col = (s.columns ?? [])[k] as { align?: string } | undefined;
              if (col) col.align = v;
            })}
          />
          <FormatEditor
            seg={c}
            update={(fn) => atSections(edit, index, (s) => {
              const col = (s.columns ?? [])[k] as Segment | undefined;
              if (col) fn(col);
            })}
          />
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => atSections(edit, index, (s) => { (s.columns ?? []).splice(k, 1); })}
          >
            Delete column
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn"
        onClick={() => atSections(edit, index, (s) => {
          s.columns = s.columns ?? [];
          s.columns.push({ header: '', bind: '', width_in: 1.5 });
        })}
      >
        Add column
      </button>
      <ConditionEditor section={section} index={index} edit={edit} />
    </div>
  );
}

export function CalloutEditor({ section, index, edit }: { section: Section; index: number; edit: SpecEditFn }) {
  return (
    <div>
      <TextField
        label="Label"
        value={section.label ?? ''}
        onCommit={(v) => atSections(edit, index, (s) => { s.label = v; })}
      />
      <SelectField
        label="Align"
        value={section.align ?? 'right'}
        options={[{ value: 'left', label: 'left' }, { value: 'center', label: 'center' }, { value: 'right', label: 'right' }]}
        onChange={(v) => atSections(edit, index, (s) => { s.align = v; })}
      />
      <SegList
        segs={section.segments ?? []}
        {...segListProps(edit, index, (s) => s.segments, (s) => (s.segments = s.segments ?? []))}
      />
      <ConditionEditor section={section} index={index} edit={edit} />
    </div>
  );
}

export function ListEditor({ section, index, edit }: { section: Section; index: number; edit: SpecEditFn }) {
  const bound = section.items !== undefined && !Array.isArray(section.items);
  return (
    <div>
      <SelectField
        label="Style"
        value={section.style ?? 'bullet'}
        options={[{ value: 'bullet', label: 'bullet' }, { value: 'number', label: 'number' }]}
        onChange={(v) => atSections(edit, index, (s) => { s.style = v; })}
      />
      <TextField
        label="Title (optional)"
        value={section.title ?? ''}
        onCommit={(v) => atSections(edit, index, (s) => {
          if (v === '') delete s.title;
          else s.title = v;
        })}
      />
      <SelectField
        label="Items"
        value={bound ? 'bind' : 'static'}
        options={[{ value: 'static', label: 'static' }, { value: 'bind', label: 'bound array' }]}
        onChange={(v) => atSections(edit, index, (s) => {
          s.items = v === 'bind' ? { bind: '' } : [{ segments: [{ text: '' }] }];
        })}
      />
      {bound ? (
        <>
          <TextField
            label="Array slot"
            placeholder="notes"
            value={(section.items as { bind?: string }).bind ?? ''}
            onCommit={(v) => atSections(edit, index, (s) => {
              const items = (s.items && !Array.isArray(s.items) ? s.items : { bind: '' }) as { bind?: string };
              items.bind = v;
              s.items = items;
            })}
          />
          <TextField
            label="Row field (objects only)"
            placeholder="text"
            value={(section.items as { field?: string }).field ?? ''}
            onCommit={(v) => atSections(edit, index, (s) => {
              const items = (s.items && !Array.isArray(s.items) ? s.items : { bind: '' }) as { bind?: string; field?: string };
              if (v === '') delete items.field;
              else items.field = v;
              s.items = items;
            })}
          />
        </>
      ) : (
        <>
          {((section.items ?? []) as Array<{ segments?: Segment[] }>).map((it, k) => (
            <div key={k} className="rule-block">
              <div className="status-line num">Item {k + 1}</div>
              {(it.segments ?? []).map((g, j) => (
                <SegmentRow
                  key={j}
                  seg={g}
                  allowPage={false}
                  update={(fn) => atSections(edit, index, (s) => {
                    const list = ((s.items as Array<{ segments?: Segment[] }>)?.[k])?.segments;
                    if (list?.[j]) fn(list[j]);
                  })}
                  onDelete={() => atSections(edit, index, (s) => {
                    (((s.items as Array<{ segments?: Segment[] }>)?.[k])?.segments ?? []).splice(j, 1);
                  })}
                />
              ))}
              <div className="toolbar">
                <button
                  type="button"
                  className="btn"
                  onClick={() => atSections(edit, index, (s) => {
                    const item = (s.items as Array<{ segments?: Segment[] }>)?.[k];
                    if (item) {
                      item.segments = item.segments ?? [];
                      item.segments.push({ text: '' });
                    }
                  })}
                >
                  Add segment
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => atSections(edit, index, (s) => {
                    (s.items as unknown[])?.splice(k, 1);
                  })}
                >
                  Delete item
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="btn"
            onClick={() => atSections(edit, index, (s) => {
              if (Array.isArray(s.items)) s.items.push({ segments: [{ text: '' }] });
            })}
          >
            Add item
          </button>
        </>
      )}
      <ConditionEditor section={section} index={index} edit={edit} />
    </div>
  );
}

export function ConditionEditor({ section, index, edit }: { section: Section; index: number; edit: SpecEditFn }) {
  const mode = condMode(section.if);
  const rows: Array<{ ref?: string; op?: string; value?: unknown }> =
    mode === 'single' ? [section.if as { ref?: string; op?: string; value?: unknown }] : mode === 'none' ? [] : (section.if as { all?: Array<{ ref?: string; op?: string; value?: unknown }>; any?: Array<{ ref?: string; op?: string; value?: unknown }> })[mode] ?? [];
  const setRow = (k: number, patch: Record<string, unknown>) => atSections(edit, index, (s) => {
    const m = condMode(s.if);
    const list = m === 'single' ? [s.if] : (s.if as Record<string, Array<Record<string, unknown>>>)?.[m] ?? [];
    if (list[k]) Object.assign(list[k], patch);
  });
  return (
    <div>
      <SelectField
        label="Show when"
        value={mode}
        options={[{ value: 'none', label: 'none (always)' }, { value: 'single', label: 'single' }, { value: 'all', label: 'all' }, { value: 'any', label: 'any' }]}
        onChange={(v) => atSections(edit, index, (s) => setCondMode(s, v as 'none' | 'single' | 'all' | 'any'))}
      />
      {rows.map((r, k) => (
        <div key={k} className="map-row">
          <TextField label={`Condition ${k + 1} slot`} placeholder="totals.price" value={r.ref ?? ''} onCommit={(v) => setRow(k, { ref: v })} />
          <SelectField
            label="Comparison"
            value={r.op ?? 'eq'}
            options={PRED_OPS.map((o) => ({ value: o, label: o }))}
            onChange={(v) => setRow(k, { op: v })}
          />
          {r.op !== 'exists' && (
            <TextField label="Against" value={fmtDisplay(r.value)} onCommit={(v) => setRow(k, { value: smartValue(v) })} />
          )}
          <button
            type="button"
            className="btn"
            aria-label={`Delete condition ${k + 1}`}
            onClick={() => atSections(edit, index, (s) => {
              const m = condMode(s.if);
              if (m === 'single') delete s.if;
              else (s.if as Record<string, unknown[]>)?.[m]?.splice(k, 1);
            })}
          >
            ×
          </button>
        </div>
      ))}
      {(mode === 'all' || mode === 'any') && (
        <button
          type="button"
          className="btn"
          onClick={() => atSections(edit, index, (s) => {
            const m = condMode(s.if);
            if (m === 'all' || m === 'any') (s.if as Record<string, unknown[]>)?.[m]?.push({ ref: '', op: 'eq' });
          })}
        >
          Add condition
        </button>
      )}
    </div>
  );
}
