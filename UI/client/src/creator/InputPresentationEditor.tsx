import type { WorkflowDefinition } from '../api/contracts';
import type { InputFieldMeta, InputPresentation } from '../runner/inputPresentation';
import { NumberField, SelectField, TextField } from './fields';
import type { EditFn } from './stepConfigs';

// Authors the optional input-presentation metadata stored at
// definition.ui.input_presentation. Presentation only: it cannot change
// calculation semantics or invalidate the definition.
export function InputPresentationEditor({ def, edit }: { def: WorkflowDefinition; edit: EditFn }) {
  const pres: InputPresentation = ((def.ui as Record<string, unknown> | undefined)?.input_presentation as InputPresentation | undefined) ?? { version: 1 };
  const groups = pres.groups ?? [];

  const setPres = (fn: (p: InputPresentation) => void) => edit((d) => {
    const ui = { ...(d.ui ?? {}) } as Record<string, unknown>;
    const next: InputPresentation = JSON.parse(JSON.stringify(ui.input_presentation ?? { version: 1 })) as InputPresentation;
    next.version = 1;
    fn(next);
    ui.input_presentation = next;
    d.ui = ui as WorkflowDefinition['ui'];
  });

  const setField = (name: string, patch: Partial<InputFieldMeta>) => setPres((p) => {
    p.fields = p.fields ?? {};
    p.fields[name] = { ...(p.fields[name] ?? {}), ...patch };
  });

  return (
    <section aria-label="Input presentation">
      <h3>Input presentation (optional)</h3>
      <p className="status-line">
        How the Runner asks for project information: labels, units, examples, grouping and controls.
        Leave fields blank to derive plain controls from the declared input types.
      </p>
      {(def.inputs ?? []).map((inp) => {
        const meta = pres.fields?.[inp.name] ?? {};
        return (
          <details key={inp.name}>
            <summary className="num">{inp.name} <span className="status-line">({inp.type})</span></summary>
            <TextField label="Label" value={meta.label ?? ''} onCommit={(v) => setField(inp.name, { label: v })} />
            <TextField label="Unit" value={meta.unit ?? ''} onCommit={(v) => setField(inp.name, { unit: v })} />
            <TextField label="Example" value={meta.example ?? ''} onCommit={(v) => setField(inp.name, { example: v })} />
            <TextField label="Group id" value={meta.group ?? ''} onCommit={(v) => setField(inp.name, { group: v })} />
            <NumberField label="Order" value={meta.order} onCommit={(v) => setField(inp.name, { order: v })} />
            <SelectField
              label="Control"
              value={meta.control ?? 'auto'}
              options={[
                { value: 'auto', label: 'auto (from type)' },
                { value: 'text', label: 'text' },
                { value: 'number', label: 'number' },
                { value: 'boolean', label: 'switch' },
                { value: 'select', label: 'dropdown (options below)' },
                { value: 'rows', label: 'repeated rows (columns below)' },
                { value: 'json', label: 'advanced JSON' },
              ]}
              onChange={(v) => setField(inp.name, { control: v as InputFieldMeta['control'] })}
            />
            {meta.control === 'select' && (
              <TextField
                label="Options (value or value=label, comma-separated)"
                value={(meta.enum ?? []).map((o) => (o.label ? `${o.value}=${o.label}` : String(o.value))).join(', ')}
                onCommit={(v) => setField(inp.name, {
                  enum: v.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
                    const eq = s.indexOf('=');
                    const raw = eq === -1 ? s : s.slice(0, eq);
                    const num = Number(raw);
                    const value = raw !== '' && Number.isFinite(num) ? num : raw;
                    return eq === -1 ? { value } : { value, label: s.slice(eq + 1) };
                  }),
                })}
              />
            )}
            {meta.control === 'rows' && (
              <TextField
                label="Columns (key or key:number, comma-separated)"
                value={(meta.row?.columns ?? []).map((c) => (c.type === 'number' ? `${c.key}:number` : c.key)).join(', ')}
                onCommit={(v) => setField(inp.name, {
                  row: {
                    columns: v.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
                      const parts = s.split(':');
                      return { key: parts[0], type: parts[1] === 'number' ? 'number' as const : 'text' as const };
                    }),
                  },
                })}
              />
            )}
            <TextField
              label="Show only when field equals (field=value, blank = always)"
              value={meta.visibleWhen ? `${meta.visibleWhen.field}=${String(meta.visibleWhen.equals)}` : ''}
              onCommit={(v) => {
                const t = v.trim();
                if (t === '') {
                  setPres((p) => {
                    if (p.fields?.[inp.name]) delete p.fields[inp.name].visibleWhen;
                  });
                  return;
                }
                const eq = t.indexOf('=');
                if (eq === -1) return;
                const raw = t.slice(eq + 1);
                const equals = raw === 'true' ? true : raw === 'false' ? false : raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw;
                setField(inp.name, { visibleWhen: { field: t.slice(0, eq), equals } });
              }}
            />
          </details>
        );
      })}
      <h3>Groups</h3>
      {groups.map((g, i) => (
        <div key={`${g.id}-${i}`} className="map-row">
          <input
            type="text"
            aria-label={`Group ${i + 1} id`}
            placeholder="id"
            value={g.id}
            onChange={(e) => setPres((p) => {
              if (p.groups?.[i]) p.groups[i].id = e.target.value;
            })}
          />
          <input
            type="text"
            aria-label={`Group ${i + 1} title`}
            placeholder="Title"
            value={g.title}
            onChange={(e) => setPres((p) => {
              if (p.groups?.[i]) p.groups[i].title = e.target.value;
            })}
          />
          <button
            type="button"
            className="btn"
            aria-label={`Remove group ${g.id}`}
            onClick={() => setPres((p) => {
              p.groups = (p.groups ?? []).filter((_, n) => n !== i);
            })}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="btn" onClick={() => setPres((p) => {
        p.groups = [...(p.groups ?? []), { id: `group${(p.groups ?? []).length + 1}`, title: 'Group' }];
      })}
      >
        Add group
      </button>
      <button
        type="button"
        className="btn btn-danger"
        onClick={() => edit((d) => {
          const ui = { ...(d.ui ?? {}) } as Record<string, unknown>;
          delete ui.input_presentation;
          d.ui = ui as WorkflowDefinition['ui'];
        })}
      >
        Remove all presentation metadata
      </button>
    </section>
  );
}
