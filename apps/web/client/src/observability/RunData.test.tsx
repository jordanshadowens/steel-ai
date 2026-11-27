import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { RecordedTable } from './RunData';

afterEach(cleanup);

it('renders measurements as rows and suppresses credential values in nested evidence', () => {
  const {container} = render(<RecordedTable value={{
    samples:[{timestamp:'2026-01-02T03:04:05Z', utilization_percent:94.2}],
    details:{api_key:'private fixture', connection:'postgres://test:key@db', reply:'Bearer private-token'},
  }} />);
  expect(screen.getByRole('columnheader', {name:'Utilization percent'})).toBeTruthy();
  expect(screen.getByText('94.2')).toBeTruthy();
  expect(screen.getAllByText('[redacted]')).toHaveLength(3);
  expect(container.querySelector('pre')).toBeNull();
  expect(container.textContent).not.toContain('private');
});
