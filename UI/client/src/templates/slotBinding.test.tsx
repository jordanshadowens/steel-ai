import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SlotBindingFields } from './SlotDesignerBinding';
import type { DesignerRecord, DesignerTypeDetail } from '../api/contracts';

afterEach(cleanup);

const TYPES = [
  {
    type_id: 'ut_a', name: 'Book', version: 1,
    fields: [{ field_id: 'uf_1', name: 'title', ftype: 'text', status: 'active' }],
  },
] as unknown as DesignerTypeDetail[];

const RECS = [{ record_id: 'rec_1', values: { title: 'Dune' } }] as unknown as DesignerRecord[];

it('slot binding cascades type -> record -> field, defaulting to whole record', () => {
  const onChange = vi.fn();
  const { rerender } = render(<SlotBindingFields slot="heading" types={TYPES} records={[]} recordsLoading={false} value={null} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Slot heading bound type'), { target: { value: 'Book' } });
  expect(onChange).toHaveBeenCalledWith({ type: 'Book', record_id: '' });
  rerender(<SlotBindingFields slot="heading" types={TYPES} records={RECS} recordsLoading={false} value={{ type: 'Book', record_id: '' }} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Slot heading bound record'), { target: { value: 'rec_1' } });
  expect(onChange).toHaveBeenCalledWith({ type: 'Book', record_id: 'rec_1' });
  rerender(<SlotBindingFields slot="heading" types={TYPES} records={RECS} recordsLoading={false} value={{ type: 'Book', record_id: 'rec_1' }} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Slot heading bound field'), { target: { value: 'title' } });
  expect(onChange).toHaveBeenCalledWith({ type: 'Book', record_id: 'rec_1', field: 'title' });
});
