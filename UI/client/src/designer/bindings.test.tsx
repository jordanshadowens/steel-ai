import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DesignerBindingFields } from './DesignerBindingPicker';
import type { DesignerTypeDetail } from '../api/contracts';

afterEach(cleanup);

const TYPES = [
  { type_id: 'ut_a', name: 'Book', version: 2, fields: [{ field_id: 'uf_1', name: 'title', ftype: 'text', status: 'active' }], relationships: [] },
  { type_id: 'ut_b', name: 'Author', version: 1, fields: [], relationships: [] },
] as unknown as DesignerTypeDetail[];

it('binding fields cascade type -> mode -> field, and clear to none', () => {
  const onChange = vi.fn();
  const { rerender } = render(<DesignerBindingFields types={TYPES} value={null} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Bound designer type'), { target: { value: 'Book' } });
  expect(onChange).toHaveBeenCalledWith({ type: 'Book' });
  rerender(<DesignerBindingFields types={TYPES} value={{ type: 'Book' }} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Binding mode'), { target: { value: 'value' } });
  expect(onChange).toHaveBeenCalledWith({ type: 'Book', mode: 'value' });
  rerender(<DesignerBindingFields types={TYPES} value={{ type: 'Book', mode: 'value' }} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Bound field'), { target: { value: 'title' } });
  expect(onChange).toHaveBeenCalledWith({ type: 'Book', mode: 'value', field: 'title' });
  fireEvent.change(screen.getByLabelText('Bound designer type'), { target: { value: '' } });
  expect(onChange).toHaveBeenCalledWith(null);
});
