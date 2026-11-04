import { useState } from 'react';
import type { DesignerRelationship, DesignerTypeRow } from '../api/contracts';

export interface RelationshipDraft {
  dst_type: string;
  name: string;
  reverse_name: string;
  cardinality: 'one' | 'many';
  delete_behavior: 'restrict' | 'cascade' | 'set_null';
}

export interface RelationshipEditorProps {
  relationships: DesignerRelationship[];
  types: DesignerTypeRow[];
  ownTypeId: string;
  busy: boolean;
  error: string | null;
  onAdd: (spec: RelationshipDraft) => void;
  onUpdate: (rel_id: string, patch: Record<string, unknown>) => void;
  onRetire: (rel_id: string) => void;
}

const emptyDraft: RelationshipDraft = { dst_type: '', name: '', reverse_name: '', cardinality: 'many', delete_behavior: 'restrict' };

export function RelationshipEditor(props: RelationshipEditorProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<RelationshipDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<RelationshipDraft>(emptyDraft);
  const [localError, setLocalError] = useState<string | null>(null);

  const peerName = (id: string): string => props.types.find((t) => t.type_id === id)?.name ?? id;
  const startEdit = (r: DesignerRelationship) => {
    setEditingId(r.rel_id);
    setEdit({ dst_type: r.dst_type, name: r.name, reverse_name: r.reverse_name ?? '', cardinality: r.cardinality, delete_behavior: r.delete_behavior });
    setLocalError(null);
  };
  const submitEdit = () => {
    if (!editingId) return;
    if (edit.delete_behavior === 'set_null' && edit.cardinality !== 'one') {
      setLocalError('set_null needs cardinality one');
      return;
    }
    props.onUpdate(editingId, { name: edit.name, reverse_name: edit.reverse_name || null, cardinality: edit.cardinality, delete_behavior: edit.delete_behavior, dst_type: edit.dst_type });
    setEditingId(null);
  };
  const submitAdd = () => {
    if (!draft.dst_type || !draft.name.trim()) {
      setLocalError('a target type and a name are required');
      return;
    }
    if (draft.delete_behavior === 'set_null' && draft.cardinality !== 'one') {
      setLocalError('set_null needs cardinality one');
      return;
    }
    props.onAdd({ ...draft, name: draft.name.trim() });
    setDraft(emptyDraft);
    setAdding(false);
    setLocalError(null);
  };

  const form = (s: RelationshipDraft, set: (patch: Partial<RelationshipDraft>) => void, submitLabel: string, onSubmit: () => void, onCancel: () => void) => (
    <div className="panel-card">
      <div className="designer-formgrid">
        <label className="field">
          <span>Name</span>
          <input type="text" aria-label="Relationship name" value={s.name} onChange={(e) => set({ name: e.target.value })} disabled={props.busy} />
        </label>
        <label className="field">
          <span>Target type</span>
          <select aria-label="Relationship target type" value={s.dst_type} onChange={(e) => set({ dst_type: e.target.value })} disabled={props.busy}>
            <option value="">— pick —</option>
            {props.types.map((t) => (
              <option key={t.type_id} value={t.type_id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Reverse name (optional)</span>
          <input type="text" aria-label="Relationship reverse name" value={s.reverse_name} onChange={(e) => set({ reverse_name: e.target.value })} disabled={props.busy} />
        </label>
        <label className="field">
          <span>Cardinality</span>
          <select aria-label="Relationship cardinality" value={s.cardinality} onChange={(e) => set({ cardinality: e.target.value as 'one' | 'many' })} disabled={props.busy}>
            <option value="many">many</option>
            <option value="one">one</option>
          </select>
        </label>
        <label className="field">
          <span>Delete behavior</span>
          <select aria-label="Relationship delete behavior" value={s.delete_behavior} onChange={(e) => set({ delete_behavior: e.target.value as RelationshipDraft['delete_behavior'] })} disabled={props.busy}>
            <option value="restrict">restrict (targets stay while linked)</option>
            <option value="cascade">cascade (targets follow the source)</option>
            <option value="set_null">set_null (one-links drop)</option>
          </select>
        </label>
      </div>
      <div className="toolbar">
        <button type="button" className="btn btn-primary" disabled={props.busy} onClick={onSubmit}>
          {submitLabel}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="section-card">
      <h2>Relationships</h2>
      <p className="status-line">Directed edges out of this type. Restrict blocks target deletion while links exist; cascade deletes targets with the source.</p>
      {props.relationships.length === 0 && <p className="status-line">No relationships yet.</p>}
      <table className="grid">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Target</th>
            <th scope="col">Cardinality</th>
            <th scope="col">On delete</th>
            <th scope="col">Status</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {props.relationships.map((r) => (
            <tr key={r.rel_id}>
              <td>
                <code>{r.name}</code>
              </td>
              <td>{peerName(r.dst_type)}</td>
              <td>{r.cardinality}</td>
              <td>{r.delete_behavior}</td>
              <td>{r.status}</td>
              <td>
                <span className="toolbar" style={{ margin: 0 }}>
                  <button type="button" className="btn btn-filter" disabled={props.busy} onClick={() => startEdit(r)}>
                    Edit
                  </button>
                  {r.status === 'active' && (
                    <button type="button" className="btn btn-filter" disabled={props.busy} onClick={() => props.onRetire(r.rel_id)}>
                      Retire
                    </button>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editingId && form(edit, (p) => setEdit((prev) => ({ ...prev, ...p })), 'Save relationship', submitEdit, () => setEditingId(null))}
      {adding ? (
        form(draft, (p) => setDraft((prev) => ({ ...prev, ...p })), 'Add relationship', submitAdd, () => setAdding(false))
      ) : (
        <button type="button" className="btn" disabled={props.busy} onClick={() => setAdding(true)}>
          Add relationship
        </button>
      )}
      {(localError ?? props.error) && (
        <p className="field-error" role="alert">
          {localError ?? props.error}
        </p>
      )}
    </div>
  );
}
