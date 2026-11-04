import type { SheetTemplateSpec } from '../api/contracts';

// Structured spreadsheet-template editor: sheets, shared texts, typed cells
// (numbers, text refs, formulas, verified pins), fillable bindings, and the
// optional interpreter builder program. Server validation stays
// authoritative; this editor only produces schema-shaped drafts.
export function SheetEditor({ spec, edit }: {
  spec: SheetTemplateSpec;
  edit: (fn: (s: SheetTemplateSpec) => void) => void;
}) {
  const def = (spec.definition ?? {}) as { sheets?: Array<{ name?: string; cols?: number; rows?: number }> };
  const data = (spec.data ?? {}) as { texts?: string[]; cells?: Array<Record<string, unknown>> };
  const sheets = def.sheets ?? [];
  const texts = data.texts ?? [];
  const cells = data.cells ?? [];
  const bindings = spec.bindings ?? [];

  const setTexts = (next: string[]) => edit((s) => {
    s.data = s.data ?? {};
    (s.data as { texts?: string[] }).texts = next;
  });
  const setCells = (next: Array<Record<string, unknown>>) => edit((s) => {
    s.data = s.data ?? {};
    (s.data as { cells?: Array<Record<string, unknown>> }).cells = next;
  });

  return (
    <div>
      <div className="field">
        <span><label htmlFor="sheet-title">Title</label></span>
        <input id="sheet-title" type="text" value={spec.title ?? ''} onChange={(e) => edit((s) => { s.title = e.target.value; })} />
      </div>

      <section aria-label="Sheets">
        <h3>Sheets ({sheets.length})</h3>
        {sheets.map((sh, i) => (
          <div key={i} className="map-row">
            <div className="field">
              <span><label htmlFor={`sheet-name-${i}`}>Name</label></span>
              <input id={`sheet-name-${i}`} type="text" value={sh.name ?? ''} onChange={(e) => edit((s) => {
                const list = ((s.definition ?? {}) as { sheets?: Array<{ name?: string }> }).sheets ?? [];
                if (list[i]) list[i].name = e.target.value;
              })}
              />
            </div>
            <div className="field">
              <span><label htmlFor={`sheet-cols-${i}`}>Columns</label></span>
              <input id={`sheet-cols-${i}`} type="number" min={1} max={64} value={sh.cols ?? 8} onChange={(e) => edit((s) => {
                const list = ((s.definition ?? {}) as { sheets?: Array<{ cols?: number }> }).sheets ?? [];
                if (list[i]) list[i].cols = Number(e.target.value);
              })}
              />
            </div>
            <div className="field">
              <span><label htmlFor={`sheet-rows-${i}`}>Rows</label></span>
              <input id={`sheet-rows-${i}`} type="number" min={1} max={512} value={sh.rows ?? 50} onChange={(e) => edit((s) => {
                const list = ((s.definition ?? {}) as { sheets?: Array<{ rows?: number }> }).sheets ?? [];
                if (list[i]) list[i].rows = Number(e.target.value);
              })}
              />
            </div>
            <button
              type="button"
              className="btn"
              aria-label={`Remove sheet ${sh.name ?? i}`}
              disabled={sheets.length <= 1}
              onClick={() => edit((s) => {
                const d = (s.definition ?? {}) as { sheets?: unknown[] };
                d.sheets = (d.sheets ?? []).filter((_, j) => j !== i);
              })}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn"
          disabled={sheets.length >= 8}
          onClick={() => edit((s) => {
            const d = (s.definition ?? {}) as { sheets?: Array<{ name: string; cols: number; rows: number }> };
            s.definition = { ...(s.definition ?? {}), sheets: [...(d.sheets ?? []), { name: `Sheet${(d.sheets ?? []).length + 1}`, cols: 8, rows: 50 }] } as never;
          })}
        >
          Add sheet
        </button>
      </section>

      <section aria-label="Shared texts">
        <h3>Shared texts ({texts.length})</h3>
        {texts.map((t, i) => (
          <div key={i} className="map-row">
            <div className="field">
              <span><label htmlFor={`sheet-text-${i}`}>texts[{i}]</label></span>
              <input id={`sheet-text-${i}`} type="text" value={t} onChange={(e) => setTexts(texts.map((x, j) => (j === i ? e.target.value : x)))} />
            </div>
            <button type="button" className="btn" aria-label={`Remove texts[${i}]`} onClick={() => setTexts(texts.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button type="button" className="btn" onClick={() => setTexts([...texts, ''])}>Add text</button>
      </section>

      <section aria-label="Cells">
        <h3>Cells ({cells.length})</h3>
        <p className="status-line">Types: n number · t shared-text ref · f formula (UPPERCASE, own sheet) · v verified interpreter pin. Formulas recalculate in the interpreter; errors surface per cell, never as silent zeros.</p>
        {cells.map((c, i) => (
          <CellRow
            key={i}
            index={i}
            cell={c}
            sheetName={(sheets[Number(c.s) ?? 0]?.name as string | undefined) ?? `sheet ${String(c.s)}`}
            onChange={(next) => setCells(cells.map((x, j) => (j === i ? next : x)))}
            onRemove={() => setCells(cells.filter((_, j) => j !== i))}
          />
        ))}
        <button type="button" className="btn" onClick={() => setCells([...cells, { s: 0, r: 0, c: cells.length, t: 'n', v: 0 }])}>Add cell</button>
      </section>

      <section aria-label="Fillable bindings">
        <h3>Bindings ({bindings.length})</h3>
        <p className="status-line">Data paths workflows fill at generation time, e.g. texts[2], cells[5].v. Repeating data rows bind a path per row; formulas referencing those rows fill down when the workflow maps them.</p>
        {bindings.map((b, i) => (
          <div key={i} className="map-row">
            <div className="field">
              <span><label htmlFor={`sheet-bind-${i}`}>bindings[{i}]</label></span>
              <input id={`sheet-bind-${i}`} type="text" value={b} onChange={(e) => edit((s) => { s.bindings = (s.bindings ?? []).map((x, j) => (j === i ? e.target.value : x)); })} />
            </div>
            <button type="button" className="btn" aria-label={`Remove binding ${b}`} onClick={() => edit((s) => { s.bindings = (s.bindings ?? []).filter((_, j) => j !== i); })}>×</button>
          </div>
        ))}
        <button type="button" className="btn" onClick={() => edit((s) => { s.bindings = [...(s.bindings ?? []), '']; })}>Add binding</button>
      </section>

      <section aria-label="Builder program">
        <h3>Interpreter program (optional)</h3>
        <p className="status-line">A .lang builder calling art_* primitives. When empty, the workflow step must provide the program.</p>
        <div className="field">
          <span><label htmlFor="sheet-program">program</label></span>
          <textarea id="sheet-program" rows={4} value={spec.program ?? ''} onChange={(e) => edit((s) => { s.program = e.target.value; })} placeholder="print art_create(); … print art_build();" />
        </div>
      </section>
    </div>
  );
}

function CellRow({ index, cell, sheetName, onChange, onRemove }: {
  index: number;
  cell: Record<string, unknown>;
  sheetName: string;
  onChange: (next: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const t = cell.t === 't' || cell.t === 'f' || cell.t === 'v' ? cell.t : 'n';
  const addr = `${sheetName}!${colName(Number(cell.c) || 0)}${(Number(cell.r) || 0) + 1}`;
  return (
    <div className="map-row">
      <span className="list-meta num" title={`cells[${index}]`}>{addr}</span>
      <div className="field">
        <span><label htmlFor={`cell-s-${index}`}>Sheet</label></span>
        <input id={`cell-s-${index}`} type="number" min={0} value={Number(cell.s) || 0} onChange={(e) => onChange({ ...cell, s: Number(e.target.value) })} />
      </div>
      <div className="field">
        <span><label htmlFor={`cell-r-${index}`}>Row</label></span>
        <input id={`cell-r-${index}`} type="number" min={0} value={Number(cell.r) || 0} onChange={(e) => onChange({ ...cell, r: Number(e.target.value) })} />
      </div>
      <div className="field">
        <span><label htmlFor={`cell-c-${index}`}>Col</label></span>
        <input id={`cell-c-${index}`} type="number" min={0} value={Number(cell.c) || 0} onChange={(e) => onChange({ ...cell, c: Number(e.target.value) })} />
      </div>
      <div className="field">
        <span><label htmlFor={`cell-t-${index}`}>Type</label></span>
        <select id={`cell-t-${index}`} value={t} onChange={(e) => onChange({ ...cell, t: e.target.value })}>
          <option value="n">n number</option>
          <option value="t">t text ref</option>
          <option value="f">f formula</option>
          <option value="v">v verified pin</option>
        </select>
      </div>
      <div className="field">
        <span><label htmlFor={`cell-v-${index}`}>Value</label></span>
        <input
          id={`cell-v-${index}`}
          type="text"
          value={String(cell.v ?? '')}
          onChange={(e) => {
            const raw = e.target.value;
            onChange({ ...cell, v: t === 'n' ? Number(raw) : t === 't' ? Number(raw) : raw });
          }}
        />
      </div>
      {t === 'v' && (
        <>
          <div className="field">
            <span><label htmlFor={`cell-skill-${index}`}>Skill</label></span>
            <input id={`cell-skill-${index}`} type="text" value={String(cell.skill ?? '')} onChange={(e) => onChange({ ...cell, skill: e.target.value })} />
          </div>
          <div className="field">
            <span><label htmlFor={`cell-ver-${index}`}>Version</label></span>
            <input id={`cell-ver-${index}`} type="number" min={1} value={Number(cell.version) || 1} onChange={(e) => onChange({ ...cell, version: Number(e.target.value) })} />
          </div>
        </>
      )}
      <button type="button" className="btn" aria-label={`Remove cell ${index}`} onClick={onRemove}>×</button>
    </div>
  );
}

function colName(c: number): string {
  let n = Math.max(0, Math.floor(c));
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}
