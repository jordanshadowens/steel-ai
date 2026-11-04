import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, useSelector } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { RevisePanel, specHash } from './RevisePanel';
import { openSpec, templateEditorReducer, updateSpec } from '../store/templateEditor';

const { reviseBox } = vi.hoisted(() => ({ reviseBox: { result: null as unknown, calls: [] as unknown[] } }));

vi.mock('../api/steelApi', () => ({
  useReviseTemplateMutation: () => [
    (body: unknown) => {
      reviseBox.calls.push(body);
      return { unwrap: () => Promise.resolve(reviseBox.result), abort: () => {} };
    },
    { isLoading: false },
  ],
}));

afterEach(() => {
  cleanup();
  reviseBox.result = null;
  reviseBox.calls = [];
});

const docSpec = {
  schema: 'steel-doc/1',
  template_id: 'doc-1',
  version: 1,
  title: 'Probe',
  page: { size: 'letter', orientation: 'portrait', margin_in: { top: 0.75, bottom: 0.75, left: 0.75, right: 0.75 } },
  styles: { font: 'Arial', size_pt: 11, heading_font: 'Arial', heading_color: '#14285A', text_color: '#000000', muted_color: '#555555', rule_color: '#999999', table_header_fill: '#E6E6E6', table_grid_color: '#5A5A5A' },
  header: null,
  footer: null,
  sections: [{ type: 'paragraph', segments: [{ text: 'hi' }] }],
};

function Harness({ templateId }: { templateId: string | null }) {
  const spec = useSelector((s: { templateEditor: { spec: unknown } }) => s.templateEditor.spec);
  return <RevisePanel kind="document" spec={spec as never} templateId={templateId} onSlots={() => {}} />;
}

function renderPanel() {
  const store = configureStore({ reducer: { templateEditor: templateEditorReducer } });
  store.dispatch(openSpec({ templateId: 'doc-1', version: 1, spec: docSpec as never, kind: 'document' }));
  render(
    <Provider store={store}>
      <Harness templateId="doc-1" />
    </Provider>,
  );
  return { store };
}

it('specHash is stable and sensitive to edits', () => {
  expect(specHash(docSpec)).toBe(specHash(JSON.parse(JSON.stringify(docSpec))));
  expect(specHash({ ...docSpec, title: 'Other' })).not.toBe(specHash(docSpec));
});

it('shows a proposal and applies it as one undoable edit', async () => {
  const proposal = { ...docSpec, title: 'Probe v2' };
  reviseBox.result = { ok: true, proposal, errors: [], kind: 'document', slots: ['customer.name'], summary: ['title changed'], base_hash: specHash(docSpec), template_id: 'doc-1' };
  const { store } = renderPanel();
  fireEvent.change(screen.getByLabelText('Change request'), { target: { value: 'Retitle it.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Edit with AI' }));
  expect(await screen.findByText('Proposed changes')).toBeTruthy();
  expect(screen.getByText('title changed')).toBeTruthy();
  // The current template travels with the request (never the change alone).
  expect(reviseBox.calls.length).toBe(1);
  expect((reviseBox.calls[0] as { spec: unknown }).spec).toEqual(docSpec);
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect((store.getState().templateEditor.spec as { title: string }).title).toBe('Probe v2');
  expect(store.getState().templateEditor.past.length).toBe(1);
  expect(screen.getByText(/Applied/)).toBeTruthy();
});

it('refuses a stale proposal after the user edits', async () => {
  const proposal = { ...docSpec, title: 'Probe v2' };
  reviseBox.result = { ok: true, proposal, errors: [], kind: 'document', slots: [], summary: ['title changed'], base_hash: specHash(docSpec), template_id: 'doc-1' };
  const { store } = renderPanel();
  fireEvent.change(screen.getByLabelText('Change request'), { target: { value: 'Retitle it.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Edit with AI' }));
  expect(await screen.findByText('Proposed changes')).toBeTruthy();
  // The user keeps editing while the proposal waits: Apply must refuse.
  store.dispatch(updateSpec({ ...docSpec, title: 'User edit' } as never));
  expect(await screen.findByText(/changed since this proposal|Proposed changes/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(screen.getByText(/changed since this proposal/)).toBeTruthy();
  expect((store.getState().templateEditor.spec as { title: string }).title).toBe('User edit');
});

it('discards proposals targeting another template', async () => {
  const proposal = { ...docSpec, title: 'Probe v2' };
  reviseBox.result = { ok: true, proposal, errors: [], kind: 'document', slots: [], summary: ['title changed'], base_hash: specHash(docSpec), template_id: 'other-doc' };
  const { store } = renderPanel();
  fireEvent.change(screen.getByLabelText('Change request'), { target: { value: 'Retitle it.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Edit with AI' }));
  expect(await screen.findByText('Proposed changes')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(screen.getByText(/not the open template/)).toBeTruthy();
  expect((store.getState().templateEditor.spec as { title: string }).title).toBe('Probe');
});
