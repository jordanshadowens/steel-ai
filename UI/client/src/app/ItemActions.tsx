import { useEffect, useRef, useState } from 'react';
import type { DependenciesResult } from '../api/contracts';
import { ModalDialog } from './FocusTrap';

// Accessible item-actions menu for library rows: labelled buttons, arrow-key
// navigation, Escape to close. Never icon-only: every action has a readable
// label so Delete/Restore are unambiguous.
export function ItemActions({ label, actions }: {
  label: string;
  actions: Array<{ id: string; label: string; danger?: boolean; disabled?: boolean; onSelect: () => void }>;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])];
      if (items.length === 0) return;
      e.preventDefault();
      const idx = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
      items[next].focus();
    };
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && e.target !== buttonRef.current) setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open ]);

  return (
    <div className="item-actions">
      <button
        ref={buttonRef}
        type="button"
        className="btn item-actions-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${label}`}
        onClick={() => setOpen(!open)}
      >
        Actions ▾
      </button>
      {open && (
        <div ref={menuRef} role="menu" aria-label={`Actions for ${label}`} className="item-actions-menu">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              className={a.danger ? 'item-actions-item item-actions-danger' : 'item-actions-item'}
              disabled={a.disabled}
              onClick={() => {
                setOpen(false);
                a.onSelect();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Delete confirmation: identifies the item, explains Trash semantics, lists
// blocking dependencies with the exact unblock action, and informational
// history notes. Cancel leaves everything unchanged.
export function DeleteDialog({ noun, id, name, versions, deps, depsLoading, depsError, deleting, error, onCancel, onConfirm }: {
  noun: 'Workflow' | 'Template';
  id: string;
  name?: string;
  versions: number;
  deps: DependenciesResult | null;
  depsLoading: boolean;
  depsError: boolean;
  deleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const blocking = deps?.blocking ?? [];
  const informational = deps?.informational ?? [];
  const canDelete = !depsLoading && !depsError && blocking.length === 0;
  return (
    <ModalDialog label={`Delete ${noun.toLowerCase()} ${id}`} onClose={onCancel}>
      <h2>Move this {noun.toLowerCase()} to Trash?</h2>
      <p>
        <strong className="num">{name || id}</strong>
        {name && name !== id && <span className="status-line num"> ({id})</span>}
      </p>
      <p>
        Delete moves <strong>{versions} version{versions === 1 ? '' : 's'}</strong> of this {noun.toLowerCase()} to Trash.
        Versions, history, and approvals are preserved; you can restore the item later.
        This affects only this item and its version family — never another item with a similar name.
      </p>
      {depsLoading && <p className="status-line">Checking for active dependencies…</p>}
      {depsError && <p className="status-bad" role="alert">Could not check dependencies. Deletion is blocked until the check succeeds.</p>}
      {blocking.length > 0 && (
        <section aria-label="Blocking dependencies">
          <h3>Cannot delete yet ({blocking.length})</h3>
          <ul>
            {blocking.map((d, i) => (
              <li key={i}>
                <span className="status-bad">{d.detail}</span>
                <br />
                <span className="status-line">{d.action}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {informational.length > 0 && (
        <section aria-label="Preserved history">
          <h3>Preserved</h3>
          <ul>
            {informational.map((d, i) => (
              <li key={i} className="status-line">{d.detail} {d.action}</li>
            ))}
          </ul>
        </section>
      )}
      {error && <p className="status-bad" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={!canDelete || deleting}
          title={blocking.length > 0 ? 'Resolve the blockers above first' : 'Move to Trash'}
          onClick={onConfirm}
        >
          {deleting ? 'Moving…' : 'Move to Trash'}
        </button>
      </div>
    </ModalDialog>
  );
}
