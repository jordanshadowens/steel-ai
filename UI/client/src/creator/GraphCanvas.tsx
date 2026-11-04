import { memo, useCallback, useEffect, useMemo, useState } from 'react';
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
} from '@xyflow/react';
import type { Connection, Edge, EdgeChange, Node, NodeChange, NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ModalDialog } from '../app/FocusTrap';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { redo, selectStep, setViewport, undo, updateDraft } from '../store/workflowEditor';
import { END_NODE_ID, TYPE_LABELS, definitionToFlow, deleteStep, structureKey, withPositions } from './adapter';
import type { StepNodeData } from './adapter';
import type { WorkflowDefinition } from '../api/contracts';
import { useNotify } from './notices';

// Custom step node. Pointer motion during drags belongs to the graph engine;
// only committed drops reach the store (see onNodeDragStop below).
const StepNode = memo(function StepNode({ data, selected }: NodeProps<Node<StepNodeData>>) {
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
      <div className="step-node-id num">{data.stepId}</div>
      <Handle type="source" position={Position.Right} style={{ top: '50%' }} title="Next step (on success)" />
      <Handle id="fail" type="source" position={Position.Right} style={{ top: '12%', background: '#b3261e' }} title="Failure target (on failure)" />
      {condHandles}
    </div>
  );
});

function EndNode() {
  return (
    <div className="end-node">
      <Handle type="target" position={Position.Left} />
      end
    </div>
  );
}

const nodeTypes = { step: StepNode, end: EndNode };

function applyConnect(def: WorkflowDefinition, conn: Connection): WorkflowDefinition | null {
  if (!conn.source || !conn.target || conn.source === conn.target) return null;
  if (conn.source === END_NODE_ID) return null;
  const target = conn.target === END_NODE_ID ? 'end' : conn.target;
  const out = JSON.parse(JSON.stringify(def)) as WorkflowDefinition;
  const step = (out.steps ?? []).find((s) => s.step_id === conn.source);
  if (!step) return null;
  if (conn.sourceHandle === 'fail') {
    if (target === 'end') delete step.on_failure;
    else step.on_failure = target;
  } else if (conn.sourceHandle?.startsWith('cond-')) {
    const i = Number(conn.sourceHandle.slice('cond-'.length));
    const rules = (step.config as Record<string, unknown> | undefined)?.rules as Array<{ goto?: string }> | undefined;
    if (!Array.isArray(rules) || !rules[i]) return null;
    rules[i].goto = target;
  } else {
    step.on_success = target;
  }
  return out;
}

function applyEdgeDelete(def: WorkflowDefinition, edgeId: string): WorkflowDefinition | null {
  const out = JSON.parse(JSON.stringify(def)) as WorkflowDefinition;
  if (edgeId.startsWith('fail:')) {
    const step = (out.steps ?? []).find((s) => s.step_id === edgeId.slice('fail:'.length));
    if (!step) return null;
    delete step.on_failure;
    return out;
  }
  if (edgeId.startsWith('cond:')) {
    const rest = edgeId.slice('cond:'.length);
    const sep = rest.lastIndexOf(':');
    const step = (out.steps ?? []).find((s) => s.step_id === rest.slice(0, sep));
    const rules = step ? ((step.config as Record<string, unknown> | undefined)?.rules as Array<{ goto?: string }> | undefined) : undefined;
    if (!step || !Array.isArray(rules) || !rules[Number(rest.slice(sep + 1))]) return null;
    rules[Number(rest.slice(sep + 1))].goto = step.on_success ?? 'end';
    return out;
  }
  return null;
}

function ViewportControls({ minimap, setMinimap }: { minimap: boolean; setMinimap: (v: boolean) => void }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const dispatch = useAppDispatch();
  const canUndo = useAppSelector((s) => s.workflowEditor.past.length > 0);
  const canRedo = useAppSelector((s) => s.workflowEditor.future.length > 0);
  return (
    <div className="viewport-controls" role="toolbar" aria-label="Canvas view">
      <ViewportButtons minimap={minimap} setMinimap={setMinimap} />
      <button type="button" className="btn" disabled={!canUndo} title="Undo (Ctrl+Z)" onClick={() => dispatch(undo())} aria-label="Undo">
        ↩
      </button>
      <button type="button" className="btn" disabled={!canRedo} title="Redo (Ctrl+Y)" onClick={() => dispatch(redo())} aria-label="Redo">
        ↪
      </button>
      <button type="button" className="btn" title="Keyboard shortcuts" onClick={() => setHelpOpen(true)} aria-label="Keyboard shortcuts">
        ?
      </button>
      {helpOpen && (
        <ModalDialog label="Keyboard shortcuts" onClose={() => setHelpOpen(false)}>
            <h2>Keyboard shortcuts</h2>
            <ul>
              <li>Delete / Backspace — delete the selected step or connection</li>
              <li>Escape — close the topmost panel, then clear selection</li>
              <li>Ctrl+Z / Ctrl+Y — undo / redo</li>
              <li>Arrow keys — move the selected step (Shift for 1px)</li>
              <li>Drag canvas background — pan; mouse wheel — zoom to cursor</li>
              <li>Drag from a step edge handle — connect steps</li>
            </ul>
            <button type="button" className="btn btn-primary" onClick={() => setHelpOpen(false)}>
              Close
            </button>
        </ModalDialog>
      )}
    </div>
  );
}

function ViewportButtons({ minimap, setMinimap }: { minimap: boolean; setMinimap: (v: boolean) => void }) {
  const { zoomIn, zoomOut, fitView, setViewport: setFlowViewport } = useReactFlow();
  const dispatch = useAppDispatch();
  return (
    <>
      <button type="button" className="btn" title="Zoom in" onClick={() => void zoomIn()} aria-label="Zoom in">
        +
      </button>
      <button type="button" className="btn" title="Zoom out" onClick={() => void zoomOut()} aria-label="Zoom out">
        −
      </button>
      <button type="button" className="btn" title="Fit graph to view" onClick={() => void fitView({ padding: 0.2 })} aria-label="Fit graph">
        Fit
      </button>
      <button
        type="button"
        className="btn"
        title="Reset saved view"
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

export function GraphCanvas({ workflowKey }: { workflowKey: string }) {
  const dispatch = useAppDispatch();
  const notify = useNotify();
  const draft = useAppSelector((s) => s.workflowEditor.draft);
  const selectedStepId = useAppSelector((s) => s.workflowEditor.selectedStepId);
  const savedViewport = useAppSelector((s) => s.workflowEditor.viewport);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [minimap, setMinimap] = useState(false);

  const key = useMemo(() => (draft ? structureKey(draft) : ''), [draft]);
  // Rebuild from the definition on structural edits or selection changes.
  // Position commits flow through the draft too, carrying identical values,
  // so the canvas never jumps after a drop.
  useEffect(() => {
    if (!draft) return;
    const flow = definitionToFlow(draft, selectedStepId);
    setNodes(flow.nodes);
    setEdges(flow.edges);
  }, [draft, key, selectedStepId, workflowKey]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      let selected: string | null | undefined;
      for (const ch of changes) {
        if (ch.type === 'select') {
          selected = ch.selected ? ch.id : selected === undefined ? null : selected;
        } else if (ch.type === 'remove' && draft) {
          const next = deleteStep(draft, ch.id);
          if (!next) {
            notify('error', 'A workflow needs at least one step.');
            const flow = definitionToFlow(draft, selectedStepId);
            setNodes(flow.nodes);
            setEdges(flow.edges);
          } else {
            dispatch(updateDraft(next));
            dispatch(selectStep(null));
            notify('ok', `Deleted ${ch.id}; dangling edges now point at end.`);
          }
        }
      }
      if (selected !== undefined) dispatch(selectStep(selected));
      setNodes((nds) => applyNodeChanges(changes.filter((c) => c.type !== 'remove'), nds));
    },
    [dispatch, draft, notify, selectedStepId],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const ch of changes) {
        if (ch.type === 'remove' && draft) {
          const next = applyEdgeDelete(draft, ch.id);
          if (next) {
            dispatch(updateDraft(next));
            notify('ok', ch.id.startsWith('fail:') ? 'Failure route removed.' : 'Rule now follows the default path.');
          }
        }
      }
      setEdges((eds) => applyEdgeChanges(changes.filter((c) => c.type !== 'remove'), eds));
    },
    [dispatch, draft, notify],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!draft) return;
      const next = applyConnect(draft, conn);
      if (!next) return;
      dispatch(updateDraft(next));
    },
    [dispatch, draft],
  );

  const onNodeDragStop = useCallback(
    (_e: unknown, _n: unknown, all: Node[]) => {
      if (!draft) return;
      const positions: Record<string, { x: number; y: number }> = {};
      for (const n of all) {
        if (n.id !== END_NODE_ID) positions[n.id] = { x: n.position.x, y: n.position.y };
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
    return <div className="canvas-empty">Open or create a workflow to edit its steps.</div>;
  }

  return (
    <div className="canvas-wrap">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onMoveEnd={onMoveEnd}
        defaultViewport={savedViewport ? { x: savedViewport.x, y: savedViewport.y, zoom: savedViewport.zoom } : undefined}
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
      <ViewportControls minimap={minimap} setMinimap={setMinimap} />
    </div>
  );
}
