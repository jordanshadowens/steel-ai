import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { apiMessage, formatScalarValue, isUnavailable, parseRepeatedInput, parseScalarInput } from './valueInputs';
import { fieldFormToPayload, emptyFieldForm } from './FieldEditor';
import { TypeList } from './TypeList';
import { RecordForm } from './RecordViews';
import { PublishPanel } from './PublishPanel';
import type { DesignerField, DesignerTypeDetail } from '../api/contracts';

afterEach(cleanup);

it('parses scalars strictly, formats back, and reads API errors', () => {
  expect(parseScalarInput('integer', '42')).toEqual({ ok: true, value: 42 });
  expect(parseScalarInput('integer', '4.2').ok).toBe(false);
  expect(parseScalarInput('integer', 'x').ok).toBe(false);
  expect(parseScalarInput('boolean', 'true')).toEqual({ ok: true, value: true });
  expect(parseScalarInput('boolean', '1').ok).toBe(false);
  expect(parseScalarInput('decimal', '19.90')).toEqual({ ok: true, value: '19.90' });
  expect(parseRepeatedInput('text', 'a\n\nb')).toEqual({ ok: true, value: ['a', 'b'] });
  expect(formatScalarValue('boolean', false)).toBe('false');
  expect(formatScalarValue('decimal', '1.50')).toBe('1.50');
  expect(apiMessage({ data: { error: 'nope' }, status: 400 })).toBe('nope');
  expect(apiMessage({ status: 501, data: {} })).toMatch(/status 501/);
  expect(apiMessage(null)).toBe('');
  expect(isUnavailable({ status: 501 })).toBe(true);
  expect(isUnavailable({ status: 400 })).toBe(false);
});

it('builds field payloads and rejects bad forms early', () => {
  const good = fieldFormToPayload({ ...emptyFieldForm, name: 'price', ftype: 'decimal', precisionText: '10', scaleText: '2' });
  expect(good.ok).toBe(true);
  if (good.ok) expect(good.spec.validation).toEqual({ precision: 10, scale: 2 });
  const noScale = fieldFormToPayload({ ...emptyFieldForm, name: 'price', ftype: 'decimal', precisionText: '10', scaleText: '' });
  expect(noScale.ok).toBe(false);
  const badName = fieldFormToPayload({ ...emptyFieldForm, name: '9x', ftype: 'text' });
  expect(badName.ok).toBe(false);
  const enumOk = fieldFormToPayload({ ...emptyFieldForm, name: 'g', ftype: 'enum', optionsText: 'a\nb' });
  expect(enumOk.ok).toBe(true);
  if (enumOk.ok) expect(enumOk.spec.validation).toEqual({ options: ['a', 'b'] });
});

const T1 = { type_id: 'ut_1', workspace_id: 'default', name: 'Book', status: 'active', version: 1 } as const;

it('type list creates, selects, and renames', () => {
  const onCreate = vi.fn();
  const onSelect = vi.fn();
  const onRename = vi.fn();
  render(
    <TypeList
      types={[{ ...T1 }]}
      selectedId={null}
      showArchived={false}
      busy={false}
      error={null}
      onToggleArchived={() => {}}
      onSelect={onSelect}
      onCreate={onCreate}
      onRename={onRename}
      onDuplicate={() => {}}
      onArchive={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText('New type name'), { target: { value: 'Author' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  expect(onCreate).toHaveBeenCalledWith('Author');
  fireEvent.click(screen.getByRole('button', { name: /Book/ }));
  expect(onSelect).toHaveBeenCalledWith('ut_1');
  fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
  fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'Volume' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onRename).toHaveBeenCalledWith('ut_1', 'Volume');
});

const FIELDS: DesignerField[] = [
  { field_id: 'uf_title', name: 'title', ftype: 'text', position: 0, required: true, unique: false, repeated: false, default: null, validation: {}, status: 'active' },
  { field_id: 'uf_pages', name: 'pages', ftype: 'integer', position: 1, required: false, unique: false, repeated: false, default: null, validation: {}, status: 'active' },
];

it('record form submits typed values and flags bad input', () => {
  const onSubmit = vi.fn();
  render(<RecordForm fields={FIELDS} submitLabel="Save record" busy={false} error={null} onSubmit={onSubmit} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText(/title/), { target: { value: 'Dune' } });
  fireEvent.change(screen.getByLabelText(/pages/), { target: { value: 'nope' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save record' }));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toMatch(/pages/);
  fireEvent.change(screen.getByLabelText(/pages/), { target: { value: '412' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save record' }));
  expect(onSubmit).toHaveBeenCalledWith({ title: 'Dune', pages: 412 });
});

const DETAIL = {
  type_id: 'ut_1',
  workspace_id: 'default',
  name: 'Book',
  status: 'active',
  version: 1,
  fields: FIELDS,
  relationships: [],
  draft_sha256: 'abc',
  validated: null,
} as DesignerTypeDetail;

it('publish panel shows refusal review: backfill inputs, destructive ack, violations', () => {
  const onPublish = vi.fn();
  render(
    <PublishPanel
      detail={DETAIL}
      versions={[{ version: 1, status: 'published', spec_sha256: 's', created_by: 'human' }]}
      validateResult={null}
      validating={false}
      validateError={null}
      publishing={false}
      publishResult={null}
      publishRefusal={{
        error: 'publish refused: 1 record conflict(s)',
        report: {
          violations: [{ record_id: 'rec_1', field: 'isbn', code: 'required-gap', message: "required 'isbn' has no value (supply backfill)" }],
          destructive: [{ op: 'field_added', name: 'isbn', reason: 'new required field' }],
        },
      }}
      rollingBack={false}
      diffOps={null}
      diffLoading={false}
      onValidate={() => {}}
      onPublish={onPublish}
      onRollback={() => {}}
      onDiff={() => {}}
    />,
  );
  expect(screen.getByText(/Backfill required/)).toBeTruthy();
  expect(screen.getByText(/new required field/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('isbn'), { target: { value: 'UNKNOWN' } });
  fireEvent.click(screen.getByLabelText(/I reviewed these changes/));
  fireEvent.click(screen.getByRole('button', { name: 'Publish new version' }));
  expect(onPublish).toHaveBeenCalledWith({ backfill: { isbn: 'UNKNOWN' }, acknowledgeDestructive: true });
});
