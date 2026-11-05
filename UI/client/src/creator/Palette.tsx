import { useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { selectStep, updateDraft } from '../store/workflowEditor';
import { STEP_TYPES, defaultConfig, definitionToFlow } from './adapter';
import type { StepType } from '../api/contracts';
import { useNotify } from './notices';

// One insertion path shared by click-to-insert and drag-and-drop.
export function useInsertStep(): (type: StepType, at: { x: number; y: number } | null) => void {
  const dispatch = useAppDispatch();
  const notify = useNotify();
  const draft = useAppSelector((s) => s.workflowEditor.draft);
  return (type, at) => {
    if (!draft) {
      notify('error', 'Open or create a workflow first.');
      return;
    }
    const steps = draft.steps ?? [];
    let n = steps.length + 1;
    while (steps.some((s) => s.step_id === `step${n}`)) n++;
    const id = `step${n}`;
    const occupied = definitionToFlow(draft, null).nodes.filter((node) => node.type === 'step');
    const pos = { ...(at ?? { x: 120, y: 120 }) };
    // Keep both click and drop insertion clear of existing node hit targets.
    while (occupied.some((node) => Math.abs(node.position.x - (pos.x - 100)) < 240 && Math.abs(node.position.y - (pos.y - 30)) < 120)) pos.y += 140;
    const next = {
      ...draft,
      steps: [...steps, { step_id: id, type, name: STEP_TYPES.find((t) => t.value === type)?.label ?? type, config: defaultConfig(type), on_success: 'end' }],
      ui: { ...(draft.ui ?? {}), positions: { ...(draft.ui?.positions ?? {}), [id]: { x: Math.max(0, Math.round(pos.x - 100)), y: Math.max(0, Math.round(pos.y - 30)) } } },
    };
    dispatch(updateDraft(next));
    dispatch(selectStep(id));
  };
}

// Floating step-insertion palette: drag onto the canvas or click to insert
// at the visible center. Drop coordinates go through screenToFlow so pan
// and zoom are honored.
export function Palette() {
  const { screenToFlowPosition } = useReactFlow();
  const insert = useInsertStep();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const q = search.trim().toLowerCase();
  const types = STEP_TYPES.filter((t) => !q || t.label.toLowerCase().includes(q) || t.value.includes(q) || t.hint.toLowerCase().includes(q));

  const insertAtCenter = (type: StepType) => {
    const el = document.querySelector('.react-flow');
    const rect = el?.getBoundingClientRect();
    const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    insert(type, screenToFlowPosition({ x: cx, y: cy }));
    setOpen(false);
  };

  return (
    <div className="palette">
      <button type="button" className="btn btn-primary palette-fab" aria-expanded={open} title="Add a step" onClick={() => setOpen(!open)}>
        + Step
      </button>
      {open && (
        <div className="palette-pop" role="dialog" aria-label="Step palette">
          <input type="search" aria-label="Search step types" placeholder="Search steps…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <ul className="plain">
            {types.map((t) => (
              <li key={t.value}>
                <div
                  className="palette-item"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/steel-step', t.value);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => insertAtCenter(t.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      insertAtCenter(t.value);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  title={`${t.hint}. Drag onto the canvas or activate to insert.`}
                >
                  <span className="list-title">+ {t.label}</span>
                  <span className="status-line">{t.hint}</span>
                </div>
              </li>
            ))}
          </ul>
          {types.length === 0 && <p className="status-line">No step types match.</p>}
        </div>
      )}
    </div>
  );
}

// Drop target wiring for the canvas wrapper: converts viewport coordinates
// and inserts the dragged step type through the same path as clicking.
export function usePaletteDrop(): {
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
} {
  const { screenToFlowPosition } = useReactFlow();
  const insert = useInsertStep();
  return {
    onDragOver: (e) => {
      if (e.dataTransfer.types.includes('application/steel-step')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    },
    onDrop: (e) => {
      const type = e.dataTransfer.getData('application/steel-step') as StepType;
      if (!type) return;
      e.preventDefault();
      insert(type, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
  };
}
