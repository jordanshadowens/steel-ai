import type { SlideTemplateSpec } from '../api/contracts';

const LAYOUTS = ['title', 'bullets', 'two_col', 'blank'];

// Structured presentation-template editor: layouts, shared texts, slides
// (layout + title + bullets), speaker notes, fillable bindings, and the
// optional interpreter builder program.
export function SlideEditor({ spec, edit }: {
  spec: SlideTemplateSpec;
  edit: (fn: (s: SlideTemplateSpec) => void) => void;
}) {
  const def = (spec.definition ?? {}) as { layouts?: string[] };
  const data = (spec.data ?? {}) as { texts?: string[]; slides?: Array<Record<string, unknown>> };
  const layouts = def.layouts ?? [];
  const texts = data.texts ?? [];
  const slides = data.slides ?? [];
  const bindings = spec.bindings ?? [];

  const setTexts = (next: string[]) => edit((s) => {
    s.data = s.data ?? {};
    (s.data as { texts?: string[] }).texts = next;
  });
  const setSlides = (next: Array<Record<string, unknown>>) => edit((s) => {
    s.data = s.data ?? {};
    (s.data as { slides?: Array<Record<string, unknown>> }).slides = next;
  });

  return (
    <div>
      <div className="field">
        <span><label htmlFor="slide-title">Title</label></span>
        <input id="slide-title" type="text" value={spec.title ?? ''} onChange={(e) => edit((s) => { s.title = e.target.value; })} />
      </div>

      <section aria-label="Layouts">
        <h3>Layouts ({layouts.length})</h3>
        <div className="map-row" role="group" aria-label="Available layouts">
          {LAYOUTS.map((l) => {
            const on = layouts.includes(l);
            return (
              <button
                key={l}
                type="button"
                className={on ? 'btn btn-filter btn-filter-active' : 'btn btn-filter'}
                aria-pressed={on}
                onClick={() => edit((s) => {
                  const d = (s.definition ?? {}) as { layouts?: string[] };
                  const cur = d.layouts ?? [];
                  d.layouts = on ? cur.filter((x) => x !== l) : [...cur, l];
                  s.definition = { ...(s.definition ?? {}), layouts: d.layouts } as never;
                })}
              >
                {l}
              </button>
            );
          })}
        </div>
      </section>

      <section aria-label="Shared texts">
        <h3>Shared texts ({texts.length})</h3>
        {texts.map((t, i) => (
          <div key={i} className="map-row">
            <div className="field">
              <span><label htmlFor={`slide-text-${i}`}>texts[{i}]</label></span>
              <input id={`slide-text-${i}`} type="text" value={t} onChange={(e) => setTexts(texts.map((x, j) => (j === i ? e.target.value : x)))} />
            </div>
            <button type="button" className="btn" aria-label={`Remove texts[${i}]`} onClick={() => setTexts(texts.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button type="button" className="btn" onClick={() => setTexts([...texts, ''])}>Add text</button>
      </section>

      <section aria-label="Slides">
        <h3>Slides ({slides.length})</h3>
        <p className="status-line">Slides keep stable positions across save/reopen; repeating slides bind one slide entry per repeated object in the workflow mapping.</p>
        {slides.map((sl, i) => (
          <div key={i} className="list-card">
            <div className="map-row">
              <span className="list-meta num">slide {i + 1}</span>
              <div className="field">
                <span><label htmlFor={`slide-layout-${i}`}>Layout</label></span>
                <select
                  id={`slide-layout-${i}`}
                  value={String(sl.layout ?? 0)}
                  onChange={(e) => setSlides(slides.map((x, j) => (j === i ? { ...x, layout: Number(e.target.value) } : x)))}
                >
                  {layouts.map((l, li) => (
                    <option key={li} value={String(li)}>{l}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <span><label htmlFor={`slide-title-${i}`}>Title text</label></span>
                <select
                  id={`slide-title-${i}`}
                  value={sl.title === null || sl.title === -1 ? '-1' : String(sl.title ?? 0)}
                  onChange={(e) => setSlides(slides.map((x, j) => (j === i ? { ...x, title: e.target.value === '-1' ? -1 : Number(e.target.value) } : x)))}
                >
                  <option value="-1">(none)</option>
                  {texts.map((t, ti) => (
                    <option key={ti} value={String(ti)}>texts[{ti}]: {t.slice(0, 24)}</option>
                  ))}
                </select>
              </div>
              <button type="button" className="btn" aria-label={`Remove slide ${i + 1}`} onClick={() => setSlides(slides.filter((_, j) => j !== i))}>×</button>
            </div>
            <div className="field">
              <span><label htmlFor={`slide-bullets-${i}`}>Bullets (comma-separated text indexes)</label></span>
              <input
                id={`slide-bullets-${i}`}
                type="text"
                value={Array.isArray(sl.bullets) ? (sl.bullets as unknown[]).join(', ') : ''}
                onChange={(e) => {
                  const parts = e.target.value.split(',').map((p) => p.trim()).filter((p) => p !== '').map(Number).filter((n) => Number.isInteger(n) && n >= 0);
                  setSlides(slides.map((x, j) => (j === i ? { ...x, bullets: parts } : x)));
                }}
                placeholder="1, 2"
              />
            </div>
            <div className="field">
              <span><label htmlFor={`slide-notes-${i}`}>Speaker notes</label></span>
              <textarea
                id={`slide-notes-${i}`}
                rows={2}
                value={typeof sl.notes === 'string' ? sl.notes : ''}
                onChange={(e) => setSlides(slides.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))}
                placeholder="Notes for the presenter…"
              />
            </div>
          </div>
        ))}
        <button
          type="button"
          className="btn"
          disabled={slides.length >= 100}
          onClick={() => setSlides([...slides, { layout: 0, title: 0, bullets: [] }])}
        >
          Add slide
        </button>
      </section>

      <section aria-label="Fillable bindings">
        <h3>Bindings ({bindings.length})</h3>
        <p className="status-line">Data paths workflows fill at generation time, e.g. texts[2], slides[1].title.</p>
        {bindings.map((b, i) => (
          <div key={i} className="map-row">
            <div className="field">
              <span><label htmlFor={`slide-bind-${i}`}>bindings[{i}]</label></span>
              <input id={`slide-bind-${i}`} type="text" value={b} onChange={(e) => edit((s) => { s.bindings = (s.bindings ?? []).map((x, j) => (j === i ? e.target.value : x)); })} />
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
          <span><label htmlFor="slide-program">program</label></span>
          <textarea id="slide-program" rows={4} value={spec.program ?? ''} onChange={(e) => edit((s) => { s.program = e.target.value; })} placeholder="print art_create(); … print art_build();" />
        </div>
      </section>
    </div>
  );
}
