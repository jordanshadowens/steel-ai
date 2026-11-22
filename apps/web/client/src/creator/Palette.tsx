import { useEffect, useId, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { selectStep, updateDraft } from '../store/workflowEditor';
import { STEP_TYPES, defaultConfig, definitionToFlow, insertWorkflowStep, stepNameWithId } from './adapter';
import type { StepType } from '../api/contracts';
import { useNotify } from './notices';

export type PaletteDrag = { type: StepType; afterId: string; complete: () => void };

// One insertion path shared by click-to-insert and drag-and-drop.
export function useInsertStep(onInserted?: (id: string) => void): (
  type: StepType,
  at: { x: number; y: number } | null,
  afterId?: string | null,
) => void {
  const dispatch = useAppDispatch();
  const notify = useNotify();
  const draft = useAppSelector((s) => s.workflowEditor.draft);
  return (type, at, afterId = null) => {
    if (!draft) {
      notify('error', 'Open or create a workflow first.');
      return;
    }
    const steps = draft.steps ?? [];
    let n = steps.length + 1;
    while (steps.some((s) => s.step_id === `step${n}`)) {
      n++;
    }
    const id = `step${n}`;
    const occupied = definitionToFlow(draft, null).nodes.filter(
      (node) => node.type === 'step',
    );
    const predecessor = occupied.find((node) => node.id === afterId);
    const pos = { ...(at ?? (predecessor
      ? { x: predecessor.position.x + 420, y: predecessor.position.y + 30 }
      : { x: 120, y: 120 })) };
    // Keep both click and drop insertion clear of existing node hit targets.
    while (
      occupied.some(
        (node) =>
          Math.abs(node.position.x - (pos.x - 100)) < 240 &&
          Math.abs(node.position.y - (pos.y - 30)) < 120,
      )
    ) {
      pos.y += 140;
    }
    const next = {
      ...draft,
      steps: insertWorkflowStep(
        steps,
        {
          step_id: id,
          type,
          name: STEP_TYPES.find((t) => t.value === type)?.label ?? type,
          config: defaultConfig(type),
          on_success: 'end',
        },
        afterId,
      ),
      ui: {
        ...(draft.ui ?? {}),
        positions: {
          ...(draft.ui?.positions ?? {}),
          [id]: {
            x: Math.max(0, Math.round(pos.x - 100)),
            y: Math.max(0, Math.round(pos.y - 30)),
          },
        },
      },
    };
    dispatch(updateDraft(next));
    if (onInserted) onInserted(id);
    else dispatch(selectStep(id));
  };
}

// Floating step-insertion palette: drag onto the canvas or click to insert
// at the visible center. Drop coordinates go through screenToFlow so pan
// and zoom are honored.
export function Palette({ onInserted, drag }: {
  onInserted: (id: string) => void;
  drag: RefObject<PaletteDrag | null>;
}) {
  const { screenToFlowPosition } = useReactFlow();
  const insert = useInsertStep(onInserted);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const [afterId, setAfterId] = useState('');
  const button = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const steps = useAppSelector((state) => state.workflowEditor.draft?.steps);
  const selectedId = useAppSelector((state) => state.workflowEditor.selectedStepId);
  const selected = steps?.find((step) => step.step_id === selectedId);
  const ends = steps?.filter((step) => !step.on_success || step.on_success === 'end') ?? [];
  const defaultAfter = selected ?? (ends.length === 1 ? ends[0] : null);

  useEffect(() => {
    if (open) searchInput.current?.focus();
    return () => { drag.current = null; };
  }, [drag, open]);

  function closePalette(restoreFocus = false) {
    setOpen(false);
    setSearch('');
    if (restoreFocus) button.current?.focus();
  }

  const q = search.trim().toLowerCase();
  const types = STEP_TYPES.filter(
    (t) =>
      !q ||
      t.label.toLowerCase().includes(q) ||
      t.value.includes(q) ||
      t.hint.toLowerCase().includes(q),
  );

  const insertAtCenter = (type: StepType) => {
    const el = document.querySelector('.react-flow');
    const rect = el?.getBoundingClientRect();
    const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    insert(type, afterId ? null : screenToFlowPosition({ x: cx, y: cy }), afterId || null);
    closePalette();
  };

  return (
    <div className="palette">
      <button
        type="button"
        ref={button}
        className="btn btn-primary palette-fab"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        title={open ? 'Close Add step' : 'Add a step'}
        onClick={() => {
          if (open) {
            closePalette(true);
          } else {
            setAfterId(defaultAfter?.step_id ?? '');
            setOpen(true);
          }
        }}
      >
        + Add step
      </button>
      {open && (
        <div
          id={panelId}
          className="palette-pop"
          role="dialog"
          aria-label="Add step"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              closePalette(true);
            }
          }}
        >
          <label className="palette-placement">
            <span>Connect after</span>
            <select value={afterId} onChange={(event) => setAfterId(event.target.value)}>
              <option value="">Leave unconnected</option>
              {(steps ?? []).map((step) => (
                <option key={step.step_id} value={step.step_id}>
                  {stepNameWithId(step)}
                </option>
              ))}
            </select>
          </label>
          <input
            ref={searchInput}
            type="search"
            aria-label="Search step types"
            placeholder="Search steps…"
            value={search}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing || !search.trim() || types.length !== 1) return;
              event.preventDefault();
              insertAtCenter(types[0].value);
            }}
            onChange={(e) => setSearch(e.target.value)}
          />
          <ul className="plain">
            {types.map((t) => (
              <li key={t.value}>
                <button
                  type="button"
                  className="palette-item"
                  draggable
                  onDragStart={(e) => {
                    drag.current = { type: t.value, afterId, complete: closePalette };
                    e.dataTransfer.setData('application/steel-step', t.value);
                    if (afterId) e.dataTransfer.setData('application/steel-after', afterId);
                    e.dataTransfer.setData('text/plain', t.label);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onDragEnd={(event) => {
                    drag.current = null;
                    if (event.dataTransfer.dropEffect === 'copy') closePalette();
                  }}
                  onClick={() => insertAtCenter(t.value)}
                  title={`${t.hint}. Drag onto the canvas or activate to insert.`}
                >
                  <span className="list-title">{t.label}</span>
                  <span className="status-line">{t.hint}</span>
                </button>
              </li>
            ))}
          </ul>
          <div role="status">
            {types.length === 0 && <p className="status-line">No matching steps.</p>}
          </div>
          {types.length === 0 && (
            <button type="button" className="btn" onClick={() => {
              setSearch('');
              searchInput.current?.focus();
            }}>Clear search</button>
          )}
        </div>
      )}
    </div>
  );
}

// Drop target wiring for the canvas wrapper: converts viewport coordinates
// and inserts the dragged step type through the same path as clicking.
export function usePaletteDrop(drag: RefObject<PaletteDrag | null>): {
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
} {
  const { screenToFlowPosition } = useReactFlow();
  const insert = useInsertStep();
  return {
    onDragOver: (e) => {
      if (drag.current || e.dataTransfer.types.includes('application/steel-step')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    },
    onDrop: (e) => {
      // WebKit can strip custom formats even during a drag within this page.
      const local = drag.current;
      const suppliedType = local?.type ?? e.dataTransfer.getData('application/steel-step');
      const type = STEP_TYPES.find(({ value }) => value === suppliedType)?.value;
      if (!type) {
        return;
      }
      e.preventDefault();
      const after = local?.afterId ?? e.dataTransfer.getData('application/steel-after');
      drag.current = null;
      insert(type, screenToFlowPosition({ x: e.clientX, y: e.clientY }), after || null);
      local?.complete();
    },
  };
}
