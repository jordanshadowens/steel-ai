// Pure adapter: workspace draft -> @xyflow/react nodes/edges, plus the
// canvas position store. Positions are VIEW state (not schema): they live
// in localStorage per workspace, never in the database, and missing
// entries fall back to a deterministic grid so the canvas never jumps.
import type { Edge, Node } from '@xyflow/react';
import { getSession } from '../auth/session';
import type { DesignerTypeDetail } from '../api/contracts';

export interface EntityNodeData extends Record<string, unknown> {
  typeId: string;
  name: string;
  version: number;
  status: string;
  fields: Array<{ name: string; ftype: string; flags: string; retired: boolean }>;
  validated: 'ok' | 'bad' | 'stale' | 'unchecked';
}

export type PositionMap = Record<string, { x: number; y: number }>;

export const FLOW_COLS = 4;
export const FLOW_DX = 300;
export const FLOW_DY = 280;

export function gridPosition(index: number): { x: number; y: number } {
  return { x: (index % FLOW_COLS) * FLOW_DX, y: Math.floor(index / FLOW_COLS) * FLOW_DY };
}

export function positionKey(workspace: string): string {
  return `steel.designer.positions.${workspace}`;
}

export function loadPositions(workspace: string): PositionMap {
  if (getSession().mode === 'account') return {};
  try {
    const raw = window.localStorage.getItem(positionKey(workspace));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: PositionMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      const p = v as { x?: unknown; y?: unknown };
      if (typeof p?.x === 'number' && typeof p?.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        out[k] = { x: p.x, y: p.y };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function savePositions(workspace: string, positions: PositionMap): void {
  if (getSession().mode === 'account') return;
  try {
    window.localStorage.setItem(positionKey(workspace), JSON.stringify(positions));
  } catch {
    // Storage full or unavailable: canvas still works, positions reset.
  }
}

function fieldFlags(required: boolean, unique: boolean, repeated: boolean): string {
  const out: string[] = [];
  if (required) out.push('req');
  if (unique) out.push('uniq');
  if (repeated) out.push('list');
  return out.join(' ');
}

function validatedOf(t: DesignerTypeDetail): EntityNodeData['validated'] {
  if (!t.validated) return 'unchecked';
  if (!t.validated.current) return 'stale';
  return t.validated.ok ? 'ok' : 'bad';
}

export function workspaceToFlow(types: DesignerTypeDetail[], positions: PositionMap, search: string): { nodes: Node<EntityNodeData>[]; edges: Edge[] } {
  const q = search.trim().toLowerCase();
  const nodes: Node<EntityNodeData>[] = types.map((t, i) => ({
    id: t.type_id,
    type: 'entity',
    position: positions[t.type_id] ?? gridPosition(i),
    data: {
      typeId: t.type_id,
      name: t.name,
      version: t.version,
      status: t.status,
      fields: t.fields.map((f) => ({ name: f.name, ftype: f.ftype, flags: fieldFlags(f.required, f.unique, f.repeated), retired: f.status !== 'active' })),
      validated: validatedOf(t),
    },
    style: q && !t.name.toLowerCase().includes(q) ? { opacity: 0.35 } : undefined,
  }));
  const edges: Edge[] = [];
  for (const t of types) {
    for (const r of t.relationships) {
      edges.push({
        id: r.rel_id,
        source: r.src_type,
        target: r.dst_type,
        label: `${r.name} (${r.cardinality}${r.delete_behavior === 'restrict' ? '' : `, ${r.delete_behavior}`})`,
        animated: false,
        style: r.status === 'active' ? undefined : { strokeDasharray: '5 4', opacity: 0.55 },
      });
    }
  }
  return { nodes, edges };
}
