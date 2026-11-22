import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  useStore as useFlowStore,
} from '@xyflow/react';
import type {
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from 'react-redux';
import type { WorkflowStep } from '../api/contracts';
import type { RootState } from '../store/store';
import { ModalDialog } from '../app/FocusTrap';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  redo,
  selectStep,
  setViewport,
  undo,
  updateDraft,
} from '../store/workflowEditor';
import {
  END_NODE_ID,
  stepTypeLabel,
  arrangeSteps,
  definitionToFlow,
  deleteStep,
  withPositions,
} from './adapter';
import type { StepNodeData } from './adapter';

type StepIssueCount = { errors: number; warnings: number };
type CreatorNodeData = StepNodeData & { issues?: StepIssueCount };
import type { WorkflowDefinition } from '../api/contracts';
import { useNotify } from './notices';

// Custom step node. Pointer motion during drags belongs to the graph engine;
// only committed drops reach the store (see onNodeDragStop below).
const StepNode = memo(function StepNode({
  data,
  selected,
}: NodeProps<Node<CreatorNodeData>>) {
  const condHandles = [];
  for (let i = 0; i < data.ruleCount; i++) {
    condHandles.push(
      <Handle
        key={i}
        id={`cond-${i}`}
        type="source"
        position={Position.Right}
        style={{ top: `${30 + i * 22}%`, background: '#8a5a00' }}
        title={`Rule ${i + 1} target`}
      />,
    );
  }
  return (
    <div className={selected ? 'step-node step-node-selected' : 'step-node'}>
      <Handle type="target" position={Position.Left} title="Connect here" />
      <div className="step-node-label">{data.label}</div>
      <div className="step-node-type">{data.typeLabel}</div>
      {data.stepId !== data.label && <div className="step-node-id num">{data.stepId}</div>}
      {data.issues && (
        <div className={data.issues.errors ? 'step-node-check status-bad' : 'step-node-check status-warn'}>
          {[
            data.issues.errors && `${data.issues.errors} ${data.issues.errors === 1 ? 'error' : 'errors'}`,
            data.issues.warnings && `${data.issues.warnings} ${data.issues.warnings === 1 ? 'warning' : 'warnings'}`,
          ].filter(Boolean).join(' · ')}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        style={{ top: '50%' }}
        title={data.stepType === 'conditional_routing' ? 'If no rule matches' : 'Next step (on success)'}
      />
      <Handle
        id="fail"
        type="source"
        position={Position.Right}
        style={{ top: '12%', background: '#b3261e' }}
        title="Failure target (on failure)"
      />
      {condHandles}
    </div>
  );
});

function EndNode() {
  return (
    <div className="end-node">
      <Handle type="target" position={Position.Left} />
      Finish
    </div>
  );
}

const nodeTypes = { step: StepNode, end: EndNode };

function applyConnect(
  def: WorkflowDefinition,
  conn: Connection,
): WorkflowDefinition | null {
  if (!conn.source || !conn.target || conn.source === conn.target) {
    return null;
  }
  if (conn.source === END_NODE_ID) {
    return null;
  }
  const target = conn.target === END_NODE_ID ? 'end' : conn.target;
  const out = JSON.parse(JSON.stringify(def)) as WorkflowDefinition;
  const step = (out.steps ?? []).find((s) => s.step_id === conn.source);
  if (!step) {
    return null;
  }
  if (conn.sourceHandle === 'fail') {
    if (target === 'end') {
      delete step.on_failure;
    } else {
      step.on_failure = target;
    }
  } else if (conn.sourceHandle?.startsWith('cond-')) {
    const i = Number(conn.sourceHandle.slice('cond-'.length));
    const rules = (step.config as Record<string, unknown> | undefined)
      ?.rules as Array<{ goto?: string }> | undefined;
    if (!Array.isArray(rules) || !rules[i]) {
      return null;
    }
    rules[i].goto = target;
  } else {
    step.on_success = target;
  }
  return out;
}

function applyEdgeDelete(
  def: WorkflowDefinition,
  edgeId: string,
): WorkflowDefinition | null {
  const out = JSON.parse(JSON.stringify(def)) as WorkflowDefinition;
  if (edgeId.startsWith('fail:')) {
    const step = (out.steps ?? []).find(
      (s) => s.step_id === edgeId.slice('fail:'.length),
    );
    if (!step) {
      return null;
    }
    delete step.on_failure;
    return out;
  }
  if (edgeId.startsWith('cond:')) {
    const rest = edgeId.slice('cond:'.length);
    const sep = rest.lastIndexOf(':');
    const step = (out.steps ?? []).find(
      (s) => s.step_id === rest.slice(0, sep),
    );
    const rules = step
      ? ((step.config as Record<string, unknown> | undefined)?.rules as
          | Array<{ goto?: string }>
          | undefined)
      : undefined;
    if (!step || !Array.isArray(rules) || !rules[Number(rest.slice(sep + 1))]) {
      return null;
    }
    rules[Number(rest.slice(sep + 1))].goto = step.on_success ?? 'end';
    return out;
  }
  return null;
}

function StepFinder({ onSelect }: { onSelect: (id: string, bodyStep?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchField = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLUListElement>(null);
  const steps = useAppSelector((state) => state.workflowEditor.draft?.steps);
  const selected = useAppSelector((state) => state.workflowEditor.selectedStepId);
  const close = useCallback(() => {
    setOpen(false);
    setSearch('');
  }, []);

  useEffect(() => {
    function openFromKeyboard(event: KeyboardEvent) {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey ||
          event.isComposing || event.defaultPrevented || open ||
          document.querySelector('[aria-modal="true"]')) return;
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.closest('.react-flow, .viewport-controls') ||
          target.closest('input, textarea, select, [contenteditable]')) return;
      event.preventDefault();
      setOpen(true);
    }
    window.addEventListener('keydown', openFromKeyboard);
    return () => window.removeEventListener('keydown', openFromKeyboard);
  }, [open]);

  const entries: Array<{ id: string; name: string; type: string; loopId?: string; loopName?: string }> = open ? [
    ...(steps ?? []).flatMap((step) => {
      const name = step.name || step.step_id;
      const body = step.type === 'iteration' && Array.isArray(step.config?.body)
        ? step.config.body as WorkflowStep[]
        : [];
      return [
        { id: step.step_id, name, type: stepTypeLabel(step) },
        ...body.filter((child) => typeof child?.step_id === 'string' && typeof child.type === 'string')
          .map((child) => ({
          id: child.step_id,
          name: child.name || child.step_id,
          type: stepTypeLabel(child),
          loopId: step.step_id,
          loopName: name,
        })),
      ];
    }),
    { id: END_NODE_ID, name: 'Finish', type: 'Workflow outputs' },
  ] : [];
  const query = search.trim().toLowerCase();
  const terms = query.split(/\s+/);
  const ranked = query
    ? entries.map((entry) => {
        const id = entry.id.toLowerCase();
        const name = entry.name.toLowerCase();
        const exact = id === query || name === query;
        const prefix = id.startsWith(query) || name.startsWith(query);
        const fields = [id, name, entry.type.toLowerCase(), entry.loopName?.toLowerCase()];
        const partial = fields.some((value) => value?.includes(query));
        const allTerms = terms.every((term) => fields.some((value) => value?.includes(term)));
        return { entry, rank: exact ? 0 : prefix ? 1 : partial ? 2 : allTerms ? 3 : 4 };
      })
    : [];
  const lastRank = ranked.some(({ rank }) => rank < 3) ? 2 : 3;
  const matches = query
    ? ranked.filter(({ rank }) => rank <= lastRank)
      .sort((a, b) => a.rank - b.rank)
      .map(({ entry }) => entry)
    : entries;

  function choose(id: string, loopId?: string) {
    close();
    if (loopId) onSelect(loopId, id);
    else onSelect(id);
  }

  return (
    <>
      <button
        type="button"
        className="btn"
        aria-haspopup="dialog"
        aria-keyshortcuts="/"
        title="Find step (/)"
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          setOpen(true);
        }}
      >
        Find step
      </button>
      {open && (
        <ModalDialog label="Find step" onClose={close}>
          <h2>Find step</h2>
          <form onSubmit={(event) => {
            event.preventDefault();
            if (matches[0]) choose(matches[0].id, matches[0].loopId);
          }}>
            <label className="step-finder-search">
              <span>Search by name, ID, or type</span>
              <input
                ref={searchField}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown' || event.nativeEvent.isComposing) return;
                  const first = results.current?.querySelector<HTMLButtonElement>('button');
                  if (!first) return;
                  event.preventDefault();
                  first.focus();
                }}
              />
            </label>
          </form>
          <p className="status-line" role="status">
            {matches.length === 0 ? 'No matching steps.' : `${matches.length} ${matches.length === 1 ? 'result' : 'results'}`}
          </p>
          {matches.length === 0 && search.trim() && (
            <button type="button" className="btn" onClick={() => {
              setSearch('');
              searchField.current?.focus();
            }}>Clear search</button>
          )}
          <ul
            ref={results}
            className="step-finder-results"
            onKeyDown={(event) => {
              if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
              const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
              const index = buttons.findIndex((button) => button === event.target);
              if (index === -1) return;
              event.preventDefault();
              if (event.key === 'Home' || event.key === 'End') {
                buttons.at(event.key === 'Home' ? 0 : -1)?.focus();
                return;
              }
              const next = index + (event.key === 'ArrowUp' ? -1 : 1);
              if (next < 0) searchField.current?.focus();
              else buttons[next]?.focus();
            }}
          >
            {matches.map(({ id, name, type, loopId, loopName }) => (
              <li key={JSON.stringify([loopId, id])}>
                <button
                  type="button"
                  className="btn"
                  aria-current={!loopId && id === selected ? 'true' : undefined}
                  onClick={() => choose(id, loopId)}
                >
                  <strong>{name}</strong>
                  <span>{id === END_NODE_ID ? type : `${type} · ${id}${loopName ? ` · In ${loopName}` : ''}`}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={close}>Close</button>
          </div>
        </ModalDialog>
      )}
    </>
  );
}

function ViewportControls({
  onGoToStep,
  minimap,
  setMinimap,
}: {
  onGoToStep: (id: string, bodyStep?: string) => void;
  minimap: boolean;
  setMinimap: (v: boolean) => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const dispatch = useAppDispatch();
  const canUndo = useAppSelector((s) => s.workflowEditor.past.length > 0);
  const canRedo = useAppSelector((s) => s.workflowEditor.future.length > 0);
  return (
    <div className="viewport-controls" role="toolbar" aria-label="Canvas view">
      <StepFinder onSelect={onGoToStep} />
      <ViewportButtons minimap={minimap} setMinimap={setMinimap} />
      <button
        type="button"
        className="btn"
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        onClick={() => dispatch(undo())}
        aria-label="Undo"
      >
        ↩
      </button>
      <button
        type="button"
        className="btn"
        disabled={!canRedo}
        title="Redo (Ctrl+Y)"
        onClick={() => dispatch(redo())}
        aria-label="Redo"
      >
        ↪
      </button>
      <button
        type="button"
        className="btn"
        title="Keyboard shortcuts"
        onClick={() => setHelpOpen(true)}
        aria-label="Keyboard shortcuts"
      >
        ?
      </button>
      {helpOpen && (
        <ModalDialog
          label="Keyboard shortcuts"
          onClose={() => setHelpOpen(false)}
        >
          <h2>Keyboard shortcuts</h2>
          <ul>
            <li>Press <kbd>Delete</kbd> or <kbd>Backspace</kbd> to remove the selected step or connection.</li>
            <li>Press <kbd>Esc</kbd> to close the open panel or clear your selection.</li>
            <li>Press <kbd>Ctrl</kbd> or <kbd>Cmd</kbd> + <kbd>S</kbd> to save.</li>
            <li>Press <kbd>Ctrl</kbd> or <kbd>Cmd</kbd> + <kbd>Z</kbd> to undo. Add <kbd>Shift</kbd> to redo.</li>
            <li>Use the arrow keys to move the selected step. Hold <kbd>Shift</kbd> to move one pixel.</li>
            <li>With the canvas or its toolbar focused, press <kbd>/</kbd> to open Find step.</li>
            <li>In Find step, press <kbd>Down</kbd> to enter the results, <kbd>Home</kbd> or <kbd>End</kbd> to jump, and <kbd>Enter</kbd> to open a step.</li>
          </ul>
          <p>Drag the canvas to pan. Scroll to zoom toward the pointer. Drag from a step handle to connect steps.</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setHelpOpen(false)}
          >
            Close
          </button>
        </ModalDialog>
      )}
    </div>
  );
}

export function graphViewPadding(canvas: HTMLElement | null) {
  const inspector = canvas?.querySelector('.inspector');
  if (!canvas || !inspector) return 0.2;
  const bounds = canvas.getBoundingClientRect();
  const panel = inspector.getBoundingClientRect();
  const strips = [
    { edge: 'right', area: (panel.left - bounds.left) * bounds.height, size: bounds.right - panel.left },
    { edge: 'left', area: (bounds.right - panel.right) * bounds.height, size: panel.right - bounds.left },
    { edge: 'bottom', area: (panel.top - bounds.top) * bounds.width, size: bounds.bottom - panel.top },
    { edge: 'top', area: (bounds.bottom - panel.bottom) * bounds.width, size: panel.bottom - bounds.top },
  ];
  const abovePanel = strips.find((strip) => strip.edge === 'bottom');
  const widest = panel.width >= bounds.width * 0.85 && abovePanel && abovePanel.area > 0
    ? abovePanel
    : strips.reduce((best, strip) => strip.area > best.area ? strip : best);
  if (widest.area <= 0) return 0.2;
  return { top: '16px', right: '16px', bottom: '16px', left: '16px',
    [widest.edge]: `${Math.round(widest.size + 16)}px` } as const;
}

function ViewportButtons({
  minimap,
  setMinimap,
}: {
  minimap: boolean;
  setMinimap: (v: boolean) => void;
}) {
  const {
    zoomIn,
    zoomOut,
    fitView,
    setViewport: setFlowViewport,
  } = useReactFlow();
  const dispatch = useAppDispatch();
  const store = useStore<RootState>();
  const zoomPercent = useFlowStore((state) => Math.round(state.transform[2] * 100));
  const atMinZoom = useFlowStore((state) => state.transform[2] <= state.minZoom);
  const atMaxZoom = useFlowStore((state) => state.transform[2] >= state.maxZoom);
  const atResetView = useFlowStore(({ transform: [x, y, zoom] }) => x === 0 && y === 0 && zoom === 1);
  function fitCanvas(button: HTMLElement) {
    void fitView({ padding: graphViewPadding(button.closest<HTMLElement>('.creator-canvas')) });
  }
  function arrange(button: HTMLElement) {
    const draft = store.getState().workflowEditor.draft;
    if (!draft) return;
    const next = arrangeSteps(draft);
    if (JSON.stringify(next.ui?.positions) !== JSON.stringify(draft.ui?.positions)) {
      dispatch(updateDraft(next));
    }
    window.requestAnimationFrame(() => fitCanvas(button));
  }
  return (
    <>
      <button
        type="button"
        className="btn"
        title="Zoom in"
        disabled={atMaxZoom}
        onClick={() => void zoomIn()}
        aria-label="Zoom in"
      >
        +
      </button>
      <button
        type="button"
        className="btn"
        title="Zoom out"
        disabled={atMinZoom}
        onClick={() => void zoomOut()}
        aria-label="Zoom out"
      >
        −
      </button>
      <span className="canvas-zoom num" title="Canvas zoom">{zoomPercent}%</span>
      <button
        type="button"
        className="btn"
        title="Fit graph to view"
        onClick={(event) => fitCanvas(event.currentTarget)}
        aria-label="Fit graph"
      >
        Fit
      </button>
      <button type="button" className="btn" title="Arrange steps without changing routes" onClick={(event) => arrange(event.currentTarget)}>
        Arrange
      </button>
      <button
        type="button"
        className="btn"
        title="Reset canvas pan and zoom to 100%"
        disabled={atResetView}
        onClick={() => {
          dispatch(setViewport({ x: 0, y: 0, zoom: 1 }));
          void setFlowViewport({ x: 0, y: 0, zoom: 1 });
        }}
        aria-label="Reset view"
      >
        Reset
      </button>
      <button
        type="button"
        className={minimap ? 'btn btn-primary' : 'btn'}
        title="Toggle overview map"
        aria-pressed={minimap}
        onClick={() => setMinimap(!minimap)}
      >
        Map
      </button>
    </>
  );
}

export function GraphCanvas({
  stepIssues,
  onGoToStep,
}: {
  stepIssues: ReadonlyMap<string, StepIssueCount>;
  onGoToStep: (id: string, bodyStep?: string) => void;
}) {
  const dispatch = useAppDispatch();
  const store = useStore<RootState>();
  const notify = useNotify();
  const draft = useAppSelector((s) => s.workflowEditor.draft);
  const selectedStepId = useAppSelector((s) => s.workflowEditor.selectedStepId);
  const savedViewport = useAppSelector((s) => s.workflowEditor.viewport);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [minimap, setMinimap] = useState(false);

  // Rebuild from the definition on structural edits or selection changes.
  // Position commits flow through the draft too, carrying identical values,
  // so the canvas never jumps after a drop.
  useEffect(() => {
    if (!draft) {
      return;
    }
    const flow = definitionToFlow(draft, selectedStepId);
    setNodes(flow.nodes.map((node) => {
      const issues = stepIssues.get(node.id);
      return issues ? { ...node, data: { ...node.data, issues } } : node;
    }));
    setEdges(flow.edges);
  }, [draft, selectedStepId, stepIssues]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      let selected: string | null | undefined;
      for (const ch of changes) {
        if (ch.type === 'select') {
          selected = ch.selected
            ? ch.id
            : selected === undefined
              ? null
              : selected;
        }
      }
      if (selected !== undefined) {
        dispatch(selectStep(selected));
      }
      setNodes((nds) =>
        applyNodeChanges(
          changes.filter((c) => c.type !== 'remove'),
          nds,
        ),
      );
    },
    [dispatch],
  );

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((current) =>
      applyEdgeChanges(changes.filter((change) => change.type !== 'remove'), current),
    );
  }, []);

  const onDelete = useCallback(({ nodes: removedNodes, edges: removedEdges }: {
    nodes: Node[];
    edges: Edge[];
  }) => {
    const editor = store.getState().workflowEditor;
    const current = editor.draft;
    if (!current) return;

    const removedIds = new Set(removedNodes.map((node) => node.id));
    const stepIds = (current.steps ?? [])
      .filter((step) => removedIds.has(step.step_id))
      .map((step) => step.step_id);
    if (stepIds.length && stepIds.length === current.steps?.length) {
      notify('error', 'Keep at least one step in the workflow.');
      return;
    }

    let next = current;
    for (const id of stepIds) next = deleteStep(next, id) ?? next;
    for (const edge of removedEdges) {
      if (!removedIds.has(edge.source) && !removedIds.has(edge.target)) {
        next = applyEdgeDelete(next, edge.id) ?? next;
      }
    }
    if (next === current) return;
    dispatch(updateDraft(next));
    if (editor.selectedStepId && removedIds.has(editor.selectedStepId)) {
      dispatch(selectStep(null));
    }
    const count = stepIds.length;
    notify('ok', count > 0
      ? `Removed ${count} ${count === 1 ? 'step' : 'steps'}.`
      : 'Removed selected connections.');
  }, [dispatch, notify, store]);

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!draft) {
        return;
      }
      const next = applyConnect(draft, conn);
      if (!next) {
        return;
      }
      dispatch(updateDraft(next));
    },
    [dispatch, draft],
  );

  const onNodeDragStop = useCallback(
    (_e: unknown, _n: unknown, all: Node[]) => {
      if (!draft) {
        return;
      }
      const positions: Record<string, { x: number; y: number }> = {};
      for (const n of all) {
        if (n.id !== END_NODE_ID) {
          positions[n.id] = { x: n.position.x, y: n.position.y };
        }
      }
      dispatch(updateDraft(withPositions(draft, positions)));
    },
    [dispatch, draft],
  );

  const onMoveEnd = useCallback(
    (_e: unknown, viewport: { x: number; y: number; zoom: number }) => {
      dispatch(setViewport(viewport));
    },
    [dispatch],
  );

  if (!draft) {
    return (
      <div className="canvas-empty">
        Open or create a workflow to edit its steps.
      </div>
    );
  }

  return (
    <div className="canvas-wrap">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onDelete={onDelete}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onMoveEnd={onMoveEnd}
        defaultViewport={
          savedViewport
            ? {
                x: savedViewport.x,
                y: savedViewport.y,
                zoom: savedViewport.zoom,
              }
            : undefined
        }
        fitView={!savedViewport}
        minZoom={0.2}
        maxZoom={2}
        deleteKeyCode={['Backspace', 'Delete']}
        multiSelectionKeyCode={null}
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        {minimap && <MiniMap pannable zoomable />}
      </ReactFlow>
      <ViewportControls minimap={minimap} setMinimap={setMinimap} onGoToStep={onGoToStep} />
    </div>
  );
}
