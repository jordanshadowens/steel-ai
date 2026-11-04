import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DeleteDialog, ItemActions } from './ItemActions';

afterEach(cleanup);

it('opens a labelled menu, activates actions, and closes on Escape', () => {
  const onOpen = vi.fn();
  const onDelete = vi.fn();
  render(<ItemActions label="wf-1" actions={[{ id: 'open', label: 'Open', onSelect: onOpen }, { id: 'delete', label: 'Delete', danger: true, onSelect: onDelete }]} />);
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Actions for wf-1' }));
  const menu = screen.getByRole('menu', { name: 'Actions for wf-1' });
  expect(menu).toBeTruthy();
  const del = screen.getByRole('menuitem', { name: 'Delete' });
  expect(del.className).toContain('item-actions-danger');
  fireEvent.click(del);
  expect(onDelete).toHaveBeenCalledOnce();
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Actions for wf-1' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(onOpen).not.toHaveBeenCalled();
});

it('delete dialog blocks on dependencies and explains Trash', () => {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  render(
    <DeleteDialog
      noun="Template"
      id="tpl-1"
      name="Quotation"
      versions={3}
      deps={{ blocking: [{ kind: 'workflow_reference', detail: 'workflow w1 v2 step gen references this template', action: 'Point step gen elsewhere first.' }], informational: [] }}
      depsLoading={false}
      depsError={false}
      deleting={false}
      error={null}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );
  expect(screen.getByText('Move this template to Trash?')).toBeTruthy();
  expect(screen.getByText(/3 versions/)).toBeTruthy();
  expect(screen.getByText(/workflow w1 v2 step gen references this template/)).toBeTruthy();
  const confirm = screen.getByRole('button', { name: 'Move to Trash' });
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onConfirm).not.toHaveBeenCalled();
});

it('delete dialog confirms when nothing blocks', () => {
  const onConfirm = vi.fn();
  render(
    <DeleteDialog
      noun="Workflow"
      id="wf-1"
      versions={1}
      deps={{ blocking: [], informational: [{ kind: 'history', detail: '2 sealed runs', action: 'History is preserved.' }] }}
      depsLoading={false}
      depsError={false}
      deleting={false}
      error={null}
      onCancel={() => {}}
      onConfirm={onConfirm}
    />,
  );
  expect(screen.getByText(/2 sealed runs/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }));
  expect(onConfirm).toHaveBeenCalledOnce();
});
