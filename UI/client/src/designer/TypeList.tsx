import { useState } from 'react';
import type { DesignerTypeRow } from '../api/contracts';

export interface TypeListProps {
  types: DesignerTypeRow[];
  selectedId: string | null;
  showArchived: boolean;
  busy: boolean;
  error: string | null;
  onToggleArchived: () => void;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string, name: string) => void;
  onArchive: (id: string, archived: boolean) => void;
}

export function TypeList(props: TypeListProps) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; mode: 'rename' | 'duplicate'; name: string } | null>(null);

  return (
    <div className="section-card">
      <h2>Entity types</h2>
      <form
        className="map-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) {
            props.onCreate(draft.trim());
            setDraft('');
          }
        }}
      >
        <input
          type="text"
          aria-label="New type name"
          placeholder="New type name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={props.busy}
        />
        <button type="submit" className="btn btn-primary" disabled={props.busy || !draft.trim()}>
          Create
        </button>
      </form>
      <label className="status-line">
        <input type="checkbox" checked={props.showArchived} onChange={props.onToggleArchived} /> Show archived
      </label>
      {props.types.length === 0 && (
        <p className="status-line">No types yet. Create one to start drafting its schema — drafts never touch live data.</p>
      )}
      <ul className="designer-typelist">
        {props.types.map((t) => (
          <li key={t.type_id} className={t.type_id === props.selectedId ? 'designer-type-active' : undefined}>
            <button type="button" className="designer-type-pick" onClick={() => props.onSelect(t.type_id)} aria-current={t.type_id === props.selectedId ? 'true' : undefined}>
              <strong>{t.name}</strong>
              <span className="status-line">
                v{t.version} · {t.status}
              </span>
            </button>
            <span className="designer-type-actions">
              <button type="button" className="btn btn-filter" disabled={props.busy} onClick={() => setEditing({ id: t.type_id, mode: 'rename', name: t.name })}>
                Rename
              </button>
              <button type="button" className="btn btn-filter" disabled={props.busy} onClick={() => setEditing({ id: t.type_id, mode: 'duplicate', name: `${t.name} copy` })}>
                Duplicate
              </button>
              {t.status === 'active' ? (
                <button type="button" className="btn btn-filter" disabled={props.busy} onClick={() => props.onArchive(t.type_id, true)}>
                  Archive
                </button>
              ) : (
                <button type="button" className="btn btn-filter" disabled={props.busy} onClick={() => props.onArchive(t.type_id, false)}>
                  Unarchive
                </button>
              )}
            </span>
            {editing?.id === t.type_id && (
              <form
                className="map-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!editing.name.trim()) return;
                  if (editing.mode === 'rename') props.onRename(editing.id, editing.name.trim());
                  else props.onDuplicate(editing.id, editing.name.trim());
                  setEditing(null);
                }}
              >
                <input type="text" aria-label={editing.mode === 'rename' ? 'New name' : 'Copy name'} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                <button type="submit" className="btn btn-primary" disabled={props.busy}>
                  {editing.mode === 'rename' ? 'Save' : 'Copy'}
                </button>
                <button type="button" className="btn" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {props.error && (
        <p className="field-error" role="alert">
          {props.error}
        </p>
      )}
    </div>
  );
}
