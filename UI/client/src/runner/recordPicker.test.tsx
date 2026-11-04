import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RecordSelect } from './RecordPicker';
import { coerceValue, resolveControl } from './inputPresentation';
import type { DesignerRecord, WorkflowInput } from '../api/contracts';

afterEach(cleanup);

const RECS = [
  { record_id: 'rec_1', values: { title: 'Dune', pages: 412 } },
  { record_id: 'rec_2', values: { title: 'Other', pages: 7 } },
] as unknown as DesignerRecord[];

it('bound inputs resolve the record control and coerce like verified values', () => {
  const inp = { name: 'book', type: 'string', required: true, designer: { type: 'Book' } } as WorkflowInput;
  expect(resolveControl(inp, { control: 'text' })).toBe('record');
  expect(coerceValue(inp, 'record', 'rec_1')).toBe('rec_1');
  expect(() => coerceValue(inp, 'record', '')).toThrow(/required/);
  const plain = { name: 'x', type: 'string' } as WorkflowInput;
  expect(resolveControl(plain, {})).toBe('text');
});

it('record select submits ids in record mode and field values in value mode', () => {
  const onChange = vi.fn();
  const { rerender } = render(<RecordSelect records={RECS} binding={{ type: 'Book' }} value="" onChange={onChange} />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'rec_2' } });
  expect(onChange).toHaveBeenCalledWith('rec_2');
  rerender(<RecordSelect records={RECS} binding={{ type: 'Book', mode: 'value', field: 'title' }} value="" onChange={onChange} />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Dune' } });
  expect(onChange).toHaveBeenCalledWith('Dune');
});
