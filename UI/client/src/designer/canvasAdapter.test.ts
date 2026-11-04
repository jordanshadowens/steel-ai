import { expect, it } from 'vitest';
import { gridPosition, loadPositions, positionKey, savePositions, workspaceToFlow } from './canvasAdapter';
import type { DesignerTypeDetail } from '../api/contracts';

const T = (over: Partial<DesignerTypeDetail> = {}): DesignerTypeDetail => ({
  type_id: 'ut_a',
  workspace_id: 'default',
  name: 'Book',
  status: 'active',
  version: 1,
  fields: [
    { field_id: 'uf_1', name: 'title', ftype: 'text', position: 0, required: true, unique: false, repeated: false, default: null, validation: {}, status: 'active' },
    { field_id: 'uf_2', name: 'old', ftype: 'text', position: 1, required: false, unique: false, repeated: false, default: null, validation: {}, status: 'retired' },
  ],
  relationships: [],
  draft_sha256: 'x',
  validated: { ok: true, draft_sha256: 'x', current: true },
  ...over,
});

it('maps types to entity nodes and rels to labeled edges', () => {
  const b = T({ type_id: 'ut_b', name: 'Author', fields: [], relationships: [], validated: null });
  const a = T({
    relationships: [
      { rel_id: 'ur_1', src_type: 'ut_a', dst_type: 'ut_b', name: 'wrote', reverse_name: null, cardinality: 'many', delete_behavior: 'restrict', status: 'active' },
      { rel_id: 'ur_2', src_type: 'ut_a', dst_type: 'ut_b', name: 'edited', reverse_name: null, cardinality: 'one', delete_behavior: 'set_null', status: 'retired' },
    ],
  });
  const flow = workspaceToFlow([a, b], {}, '');
  expect(flow.nodes.length).toBe(2);
  expect(flow.nodes[0].data?.name).toBe('Book');
  expect(flow.nodes[0].data?.fields).toEqual([
    { name: 'title', ftype: 'text', flags: 'req', retired: false },
    { name: 'old', ftype: 'text', flags: '', retired: true },
  ]);
  expect(flow.nodes[0].data?.validated).toBe('ok');
  expect(flow.nodes[1].data?.validated).toBe('unchecked');
  expect(flow.edges.length).toBe(2);
  expect(flow.edges[0].label).toBe('wrote (many)');
  expect(flow.edges[1].label).toBe('edited (one, set_null)');
  expect(flow.edges[1].style).toMatchObject({ opacity: 0.55 });
});

it('merges saved positions, grids the rest, and dims search misses', () => {
  const flow = workspaceToFlow([T(), T({ type_id: 'ut_b', name: 'Author' })], { ut_b: { x: 5, y: 6 } }, 'book');
  expect(flow.nodes[0].position).toEqual(gridPosition(0));
  expect(flow.nodes[1].position).toEqual({ x: 5, y: 6 });
  expect(flow.nodes[0].style).toBeUndefined();
  expect(flow.nodes[1].style).toMatchObject({ opacity: 0.35 });
  expect(gridPosition(5)).toEqual({ x: 300, y: 280 });
});

it('position store round-trips and fails closed on garbage', () => {
  window.localStorage.removeItem(positionKey('w1'));
  expect(loadPositions('w1')).toEqual({});
  savePositions('w1', { ut_a: { x: 1, y: 2 }, ut_b: { x: NaN, y: 0 } });
  expect(loadPositions('w1')).toEqual({ ut_a: { x: 1, y: 2 } });
  window.localStorage.setItem(positionKey('w1'), '{oops');
  expect(loadPositions('w1')).toEqual({});
  window.localStorage.removeItem(positionKey('w1'));
});
