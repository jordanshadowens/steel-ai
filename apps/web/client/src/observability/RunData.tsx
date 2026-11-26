const label = (name: string) => name.replaceAll('_', ' ').replace(/^./, char => char.toUpperCase());

const secretKey = /password|secret|credential|authorization|api.?key|access.?token|refresh.?token|id.?token|private.?key|cookie|connection.?string|raw.?sql/i;
const secretText = /\bBearer\s+\S+|\b(?:steel_(?:api|dev|test)_|github_pat_|gh[pousr]_|glpat-|AIza|ya29\.)[\w.-]+|\beyJ[\w-]+\.[\w-]+\.[\w-]+|(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/|:\/\/[^/\s]+:[^/\s]+@|[?&](?:token|password|signature|key)=/i;
export function approved(value: unknown, depth = 0): unknown {
  if (depth > 10) return '[truncated]';
  if (typeof value === 'string') return secretText.test(value) ? '[redacted]' : value.slice(0, 4096);
  if (Array.isArray(value)) return value.slice(0, 100).map(item => approved(item, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) =>
      [key, secretKey.test(key) ? '[redacted]' : approved(item, depth + 1)]));
  return value;
}

export function objectValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function TableValue({value}: {value: unknown}) {
  if (Array.isArray(value) && value.length && value.every(objectValue)) {
    const columns = [...new Set(value.flatMap(Object.keys))];
    return <table className="obs-values"><thead><tr>{columns.map(key => <th key={key} scope="col">{label(key)}</th>)}</tr></thead>
      <tbody>{value.map((item, index) => <tr key={index}>{columns.map(key =>
        <td key={key}><TableValue value={item[key]} /></td>)}</tr>)}</tbody></table>;
  }
  const entries = Array.isArray(value) ? value.map((item, index) => [String(index + 1), item] as const)
    : objectValue(value) ? Object.entries(value).filter(([,item]) => item != null) : undefined;
  if (entries) return entries.length ? <table className="obs-values"><thead><tr><th scope="col">Field</th><th scope="col">Value</th></tr></thead>
    <tbody>{entries.map(([name, item]) => <tr key={name}><th scope="row">{label(name)}</th><td><TableValue value={item} /></td></tr>)}</tbody>
  </table> : <>Not recorded</>;
  if (value === undefined || value === null) return <>Not recorded</>;
  if (typeof value === 'number') return <>{value.toLocaleString(undefined, {maximumFractionDigits: 4})}</>;
  return <>{String(value)}</>;
}

export function RecordedTable({value}: {value: unknown}) {
  return <TableValue value={approved(value)} />;
}
