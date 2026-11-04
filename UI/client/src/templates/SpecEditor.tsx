import { useState } from 'react';
import { CheckField, NumberField, SelectField, TextField } from '../creator/fields';
import { SegmentRow } from './SegmentEditor';
import { CalloutEditor, HeadingEditor, KvEditor, ListEditor, ParagraphEditor, SectionFrame, TableEditor } from './SectionEditors';
import type { SpecEditFn } from './SectionEditors';
import { FONTS, SECTION_TYPES, blankSection, moveSection } from './specEdit';
import type { Section, Segment, Spec } from './specEdit';

// Structured spec editor: document → styles → header/footer → sections.
// Raw JSON stays optional; structured controls are primary.
export function SpecEditor({ spec, edit }: { spec: Spec; edit: SpecEditFn }) {
  const [addType, setAddType] = useState('paragraph');
  const page = spec.page ?? {};
  const margin = page.margin_in ?? {};
  const st = spec.styles ?? {};
  const colors = ['heading_color', 'text_color', 'muted_color', 'rule_color', 'table_header_fill', 'table_grid_color'];

  return (
    <div>
      <section aria-label="Document">
        <h3>Document</h3>
        <TextField label="Title" value={spec.title ?? ''} onCommit={(v) => edit((s) => { s.title = v; })} />
        <div className="map-row">
          <SelectField
            label="Page size"
            value={page.size ?? 'letter'}
            options={[{ value: 'letter', label: 'letter' }, { value: 'a4', label: 'a4' }]}
            onChange={(v) => edit((s) => { s.page = s.page ?? {}; (s.page as Record<string, unknown>).size = v; })}
          />
          <SelectField
            label="Orientation"
            value={page.orientation ?? 'portrait'}
            options={[{ value: 'portrait', label: 'portrait' }, { value: 'landscape', label: 'landscape' }]}
            onChange={(v) => edit((s) => { s.page = s.page ?? {}; (s.page as Record<string, unknown>).orientation = v; })}
          />
        </div>
        <div className="map-row">
          {['top', 'bottom', 'left', 'right'].map((m) => (
            <NumberField
              key={m}
              label={`Margin ${m} (in)`}
              min={0.25}
              value={margin[m]}
              onCommit={(v) => edit((s) => {
                s.page = s.page ?? {};
                (s.page as Record<string, unknown>).margin_in = { ...((s.page as Record<string, unknown>).margin_in as object ?? {}), [m]: v };
              })}
            />
          ))}
        </div>
      </section>

      <section aria-label="Styles">
        <h3>Styles</h3>
        <div className="map-row">
          <SelectField
            label="Body font"
            value={st.font ?? 'Arial'}
            options={FONTS.map((f) => ({ value: f, label: f }))}
            onChange={(v) => edit((s) => { s.styles = s.styles ?? {}; (s.styles as Record<string, unknown>).font = v; })}
          />
          <NumberField
            label="Body size (pt)"
            min={6}
            value={st.size_pt}
            onCommit={(v) => edit((s) => { s.styles = s.styles ?? {}; (s.styles as Record<string, unknown>).size_pt = v; })}
          />
          <SelectField
            label="Heading font"
            value={st.heading_font ?? 'Arial'}
            options={FONTS.map((f) => ({ value: f, label: f }))}
            onChange={(v) => edit((s) => { s.styles = s.styles ?? {}; (s.styles as Record<string, unknown>).heading_font = v; })}
          />
        </div>
        <details>
          <summary>Advanced colors</summary>
          <div className="map-row">
            {colors.map((k) => (
              <TextField
                key={k}
                label={k}
                value={st[k] ?? ''}
                onCommit={(v) => edit((s) => { s.styles = s.styles ?? {}; (s.styles as Record<string, unknown>)[k] = v; })}
              />
            ))}
          </div>
        </details>
      </section>

      <section aria-label="Header and footer">
        <h3>Header / footer (optional)</h3>
        <HeaderFooterEditor which="header" hf={spec.header} edit={edit} />
        <HeaderFooterEditor which="footer" hf={spec.footer} edit={edit} />
      </section>

      <section aria-label="Sections">
        <h3>Sections</h3>
        {(spec.sections ?? []).map((s, i) => (
          <SectionFrame
            key={i}
            index={i}
            total={(spec.sections ?? []).length}
            onMove={(dir) => edit((draft) => { moveSection(draft, i, dir); })}
            onDelete={() => edit((draft) => { (draft.sections ?? []).splice(i, 1); })}
          >
            <p className="status-line">Type: {(s as Section).type}</p>
            <SectionBody section={s as Section} index={i} edit={edit} />
          </SectionFrame>
        ))}
        <div className="map-row">
          <select aria-label="Section type" value={addType} onChange={(e) => setAddType(e.target.value)}>
            {SECTION_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            onClick={() => edit((draft) => {
              draft.sections = draft.sections ?? [];
              draft.sections.push(blankSection(addType));
            })}
          >
            Add section
          </button>
        </div>
      </section>

      <RawJsonEditor spec={spec} edit={edit} />
    </div>
  );
}

function SectionBody({ section, index, edit }: { section: Section; index: number; edit: SpecEditFn }) {
  switch (section.type) {
    case 'heading': return <HeadingEditor section={section} index={index} edit={edit} />;
    case 'paragraph': return <ParagraphEditor section={section} index={index} edit={edit} />;
    case 'kv': return <KvEditor section={section} index={index} edit={edit} />;
    case 'table': return <TableEditor section={section} index={index} edit={edit} />;
    case 'callout': return <CalloutEditor section={section} index={index} edit={edit} />;
    case 'list': return <ListEditor section={section} index={index} edit={edit} />;
    default: return <p className="status-line">Horizontal rule. No settings.</p>;
  }
}

function HeaderFooterEditor({ which, hf, edit }: { which: 'header' | 'footer'; hf: { segments?: Segment[]; align?: string } | null | undefined; edit: SpecEditFn }) {
  const on = hf !== null && hf !== undefined;
  return (
    <div className="rule-block">
      <CheckField
        label={which}
        checked={on}
        onChange={(v) => edit((s) => {
          (s as Record<string, unknown>)[which] = v ? { segments: [{ text: '' }], align: 'center' } : null;
        })}
      />
      {on && hf && (
        <>
          <SelectField
            label="Align"
            value={hf.align ?? 'center'}
            options={[{ value: 'left', label: 'left' }, { value: 'center', label: 'center' }, { value: 'right', label: 'right' }]}
            onChange={(v) => edit((s) => {
              const h = (s as Record<string, { align?: string }>)[which];
              if (h) h.align = v;
            })}
          />
          {(hf.segments ?? []).map((g, j) => (
            <SegmentRow
              key={j}
              seg={g}
              allowPage
              update={(fn) => edit((s) => {
                const list = ((s as Record<string, { segments?: Segment[] }>)[which])?.segments;
                if (list?.[j]) fn(list[j]);
              })}
              onDelete={() => edit((s) => {
                ((s as Record<string, { segments?: Segment[] }>)[which]?.segments ?? []).splice(j, 1);
              })}
            />
          ))}
          <button
            type="button"
            className="btn"
            onClick={() => edit((s) => {
              const h = (s as Record<string, { segments?: Segment[] }>)[which];
              if (h) {
                h.segments = h.segments ?? [];
                h.segments.push({ text: '' });
              }
            })}
          >
            Add segment
          </button>
        </>
      )}
    </div>
  );
}

function RawJsonEditor({ spec, edit }: { spec: Spec; edit: SpecEditFn }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <details>
      <summary>Raw schema (optional)</summary>
      <div className="field">
        <span><label htmlFor="raw-spec">Spec JSON</label></span>
        <textarea
          id="raw-spec"
          rows={12}
          className="num"
          value={text ?? JSON.stringify(spec, null, 2)}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      {error && <p className="status-bad" role="alert">{error}</p>}
      <div className="toolbar">
        <button type="button" className="btn" onClick={() => { setText(null); setError(null); }}>
          Reset view
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            try {
              const parsed = JSON.parse(text ?? '') as Spec;
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
              setError(null);
              setText(null);
              edit(() => parsed);
            } catch {
              setError('Not valid JSON — nothing was applied. Run Validate after fixing.');
            }
          }}
        >
          Apply JSON
        </button>
      </div>
    </details>
  );
}
