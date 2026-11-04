import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
} from '@xyflow/react';
import type { Connection, Edge, EdgeChange, Node, NodeChange, NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ModalDialog } from '../app/FocusTrap';
import type { DesignerTypeDetail } from '../api/contracts';
import { gridPosition, loadPositions, savePositions, workspaceToFlow, type EntityNodeData } from './canvasAdapter';

const MAX_FIELDS_SHOWN = 10;

const EntityNode = memo(function EntityNode({ data, selected }: NodeProps<Node<EntityNodeData>>) {
  const shown = data.fields.slice(0, MAX_FIELDS_SHOWN);
  return (
    <div className={selected ? 'entity-node entity-node-selected' : 'entity-node'}>
      <Handle type="target" position={Position.Left} title="Relationship target" />
      <div className="entity-node-head">
        <strong>{data.name}</strong>
        <span className="status-line num">v{data.version}</span>
      </div>
      <div className="entity-node-badges">
        <span className="badge">{data.status}</span>
        <span className="badge" title={data.validated === 'ok' ? 'Draft validated' : data.validated === 'bad' ? 'Draft invalid' : data.validated === 'stale' ? 'Changed since check' : 'Never checked'}>
          {data.validated === 'ok' ? 'valid ✓' : data.validated}
        </span>
      </div>
      <ul className="entity-node-fields">
        {shown.map((f) => (
          <li key={f.name} className={f.retired ? 'entity-field-retired' : undefined}>
            <code>{f.name}</code> <span className="status-line">{f.ftype}{f.flags ? ` ${f.flags}` : ''}</span>
          </li>
        ))}
      </ul>
      {data.fields.length > MAX_FIELDS_SHOWN && <div className="status-line">+{data.fields.length - MAX_FIELDS_SHOWN} more in Schema</div>}
      {data.fields.length === 0 && <div className="status-line">No fields yet</div>}
      <Handle type="source" position={Position.Right} title="Drag to another card to relate" />
    </div>
  );
});

const nodeTypes = { entity: EntityNode };

function viewportKey(workspace: string): string {
  return `steel.designer.viewport.${workspace}`;
}

function loadViewport(workspace: string): { x: number; y: number; zoom: number } | null {
  try {
    const raw = window.localStorage.getItem(viewportKey(workspace));
    if (!raw) return null;
    const v = JSON.parse(raw) as { x?: unknown; y?: unknown; zoom?: unknown };
    if (typeof v.x === 'number' && typeof v.y === 'number' && typeof v.zoom === 'number') return { x: v.x, y: v.y, zoom: v.zoom };
    return null;
  } catch {
    return null;
  }
}

function CanvasButtons({ minimap, setMinimap }: { minimap: boolean; setMinimap: (v: boolean) => void }) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
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
      <button type="button" className={minimap ? 'btn btn-primary' : 'btn'} title="Toggle overview map" aria-pressed={minimap} onClick={() => setMinimap(!minimap)}>
        Map
      </button>
    </>
  );
}

export interface SchemaCanvasProps {
  workspace: string;
  types: DesignerTypeDetail[];
  selectedId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onAddRelationship: (spec: { src_type: string; dst_type: string; name: string; cardinality: 'one' | 'many'; delete_behavior: 'restrict' | 'cascade' | 'set_null' }) => void;
  onRetireRelationship: (rel_id: string) => void;
}

function SchemaCanvasInner(props: SchemaCanvasProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [minimap, setMinimap] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<{ src: string; dst: string } | null>(null);
  const [relName, setRelName] = useState('');
  const [relCard, setRelCard] = useState<'one' | 'many'>('many');
  const [relDel, setRelDel] = useState<'restrict' | 'cascade' | 'set_null'>('restrict');
  const wrapRef = useRef<HTMLDivElement>(null);
  const [savedViewport] = useState(() => loadViewport(props.workspace));

  const flowKey = useMemo(
    () => JSON.stringify(props.types.map((t) => [t.type_id, t.name, t.version, t.status, t.draft_sha256, t.validated?.ok, t.validated?.current])),
    [props.types],
  );

  useEffect(() => {
    const positions = loadPositions(props.workspace);
    const flow = workspaceToFlow(props.types, positions, search);
    setNodes(flow.nodes.map((n) => ({ ...n, selected: n.id === props.selectedId })));
    setEdges(flow.edges);
  }, [props.types, flowKey, props.selectedId, search, props.workspace]);

  const persistPositions = useCallback(
    (all: Node[]) => {
      const next: Record<string, { x: number; y: number }> = {};
      for (const n of all) next[n.id] = { x: n.position.x, y: n.position.y };
      savePositions(props.workspace, next);
    },
    [props.workspace],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      let selected: string | null | undefined;
      for (const ch of changes) {
        if (ch.type === 'select') selected = ch.selected ? ch.id : selected === undefined ? null : selected;
      }
      if (selected) props.onSelect(selected);
      setNodes((nds) => applyNodeChanges(changes.filter((c) => c.type !== 'remove'), nds));
    },
    [props],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const ch of changes) {
        if (ch.type === 'remove') props.onRetireRelationship(ch.id);
      }
      setEdges((eds) => applyEdgeChanges(changes.filter((c) => c.type !== 'remove'), eds));
    },
    [props],
  );

  const onConnect = useCallback((conn: Connection) => {
    if (!conn.source || !conn.target || conn.source === conn.target) return;
    setPending({ src: conn.source, dst: conn.target });
    setRelName('');
    setRelCard('many');
    setRelDel('restrict');
  }, []);

  const onNodeDragStop = useCallback(
    (_e: unknown, _n: unknown, all: Node[]) => persistPositions(all),
    [persistPositions],
  );

  const onMoveEnd = useCallback(
    (_e: unknown, viewport: { x: number; y: number; zoom: number }) => {
      try {
        window.localStorage.setItem(viewportKey(props.workspace), JSON.stringify(viewport));
      } catch {
        // View state only; a missed save just resets the view.
      }
    },
    [props.workspace],
  );

  // Arrow-key nudge for the selected card (the list/form tabs remain the
  // full keyboard path; this mirrors the workflow canvas alternative).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (!wrapRef.current?.contains(el) || !props.selectedId) return;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      const step = e.shiftKey ? 1 : 10;
      const d = e.key === 'ArrowLeft' ? { x: -step, y: 0 } : e.key === 'ArrowRight' ? { x: step, y: 0 } : e.key === 'ArrowUp' ? { x: 0, y: -step } : e.key === 'ArrowDown' ? { x: 0, y: step } : null;
      if (!d) return;
      e.preventDefault();
      setNodes((nds) => {
        const next = nds.map((n) => (n.id === props.selectedId ? { ...n, position: { x: n.position.x + d.x, y: n.position.y + d.y } } : n));
        persistPositions(next);
        return next;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.selectedId, persistPositions]);

  const resetLayout = useCallback(() => {
    const next: Record<string, { x: number; y: number }> = {};
    props.types.forEach((t, i) => {
      next[t.type_id] = gridPosition(i);
    });
    savePositions(props.workspace, next);
    setNodes((nds) => nds.map((n) => (next[n.id] ? { ...n, position: next[n.id] } : n)));
  }, [props.types, props.workspace]);

  if (props.types.length === 0) {
    return <div className="canvas-empty">Create a type to see it on the canvas.</div>;
  }

  const srcName = props.types.find((t) => t.type_id === pending?.src)?.name ?? '';
  const dstName = props.types.find((t) => t.type_id === pending?.dst)?.name ?? '';

  return (
    <div className="designer-canvas-wrap" ref={wrapRef}>
      <div className="toolbar">
        <label className="status-line">
          Search{' '}
          <input type="search" aria-label="Search types" placeholder="Type name" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <button type="button" className="btn" title="Reset card layout to grid" onClick={resetLayout} aria-label="Reset layout">
          Layout
        </button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onMoveEnd={onMoveEnd}
        defaultViewport={savedViewport ?? undefined}
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
      <div className="designer-viewport-controls" role="toolbar" aria-label="Canvas view">
        <CanvasButtons minimap={minimap} setMinimap={setMinimap} />
        <button type="button" className="btn" title="Keyboard shortcuts" onClick={() => setHelpOpen(true)} aria-label="Keyboard shortcuts">
          ?
        </button>
        {helpOpen && (
          <ModalDialog label="Keyboard shortcuts" onClose={() => setHelpOpen(false)}>
            <h2>Schema canvas</h2>
            <ul>
              <li>Delete / Backspace — retire the selected relationship (values preserved)</li>
              <li>Arrow keys — move the selected card (Shift for 1px)</li>
              <li>Drag canvas background — pan; mouse wheel — zoom to cursor</li>
              <li>Drag from a card edge handle — relate two types</li>
              <li>Every canvas action is also available in the Schema tab</li>
            </ul>
            <button type="button" className="btn btn-primary" onClick={() => setHelpOpen(false)}>
              Close
            </button>
          </ModalDialog>
        )}
      </div>
      {pending && (
        <ModalDialog label="New relationship" onClose={() => setPending(null)}>
          <h2>
            Relate {srcName} → {dstName}
          </h2>
          <label className="field">
            <span>Name</span>
            <input type="text" aria-label="Relationship name" value={relName} onChange={(e) => setRelName(e.target.value)} disabled={props.busy} />
          </label>
          <label className="field">
            <span>Cardinality</span>
            <select value={relCard} onChange={(e) => setRelCard(e.target.value as 'one' | 'many')} disabled={props.busy}>
              <option value="many">many</option>
              <option value="one">one</option>
            </select>
          </label>
          <label className="field">
            <span>Delete behavior</span>
            <select value={relDel} onChange={(e) => setRelDel(e.target.value as 'restrict' | 'cascade' | 'set_null')} disabled={props.busy}>
              <option value="restrict">restrict</option>
              <option value="cascade">cascade</option>
              <option value="set_null">set_null</option>
            </select>
          </label>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setPending(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={props.busy || !relName.trim() || (relDel === 'set_null' && relCard !== 'one')}
              onClick={() => {
                props.onAddRelationship({ src_type: pending.src, dst_type: pending.dst, name: relName.trim(), cardinality: relCard, delete_behavior: relDel });
                setPending(null);
              }}
            >
              Create
            </button>
          </div>
        </ModalDialog>
      )}
    </div>
  );
}

export function SchemaCanvas(props: SchemaCanvasProps) {
  return (
    <ReactFlowProvider>
      <SchemaCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
