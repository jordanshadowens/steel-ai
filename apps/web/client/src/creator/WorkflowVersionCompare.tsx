import { useState } from 'react';
import { ModalDialog } from '../app/FocusTrap';
import type { WorkflowDefinition } from '../api/contracts';
import { useGetWorkflowVersionsQuery } from '../api/steelApi';

type Change = {
  section: string;
  name: string;
  action: 'Added' | 'Removed' | 'Changed';
  details?: { from: unknown; to: unknown };
};

function comparable(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    return Object.fromEntries(
      Object.entries(entry).sort(([first], [second]) => first.localeCompare(second)),
    );
  });
}

function changedFields(from: unknown, to: unknown): { from: unknown; to: unknown } {
  if (!from || typeof from !== 'object' || Array.isArray(from) ||
      !to || typeof to !== 'object' || Array.isArray(to)) {
    return { from, to };
  }
  const before = Object.entries(from);
  const after = Object.entries(to);
  const left = new Map(before);
  const right = new Map(after);
  const fromChanges = new Map<string, unknown>();
  const toChanges = new Map<string, unknown>();
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const previous = left.get(key);
    const next = right.get(key);
    if (comparable(previous) === comparable(next)) continue;
    const change = changedFields(previous, next);
    if (left.has(key)) fromChanges.set(key, change.from);
    if (right.has(key)) toChanges.set(key, change.to);
  }
  return { from: Object.fromEntries(fromChanges), to: Object.fromEntries(toChanges) };
}

function compareEntries(
  section: string,
  before: Map<string, { name: string; value: unknown }>,
  after: Map<string, { name: string; value: unknown }>,
): Change[] {
  const changes: Change[] = [];
  for (const [key, entry] of after) {
    const previous = before.get(key);
    if (!previous) {
      changes.push({ section, name: entry.name, action: 'Added', details: { from: undefined, to: entry.value } });
    } else if (comparable(previous.value) !== comparable(entry.value)) {
      changes.push({
        section,
        name: entry.name,
        action: 'Changed',
        details: changedFields(previous.value, entry.value),
      });
    }
  }
  for (const [key, entry] of before) {
    if (!after.has(key)) {
      changes.push({ section, name: entry.name, action: 'Removed', details: { from: entry.value, to: undefined } });
    }
  }
  return changes;
}

function compareDefinitions(before: WorkflowDefinition, after: WorkflowDefinition): Change[] {
  const stepIdsByName = new Map<string, Set<string>>();
  for (const step of [...(before.steps ?? []), ...(after.steps ?? [])]) {
    const name = step.name || step.step_id;
    const ids = stepIdsByName.get(name) ?? new Set<string>();
    ids.add(step.step_id);
    stepIdsByName.set(name, ids);
  }
  const steps = (def: WorkflowDefinition) =>
    new Map((def.steps ?? []).map((step) => {
      const name = step.name || step.step_id;
      return [step.step_id, {
        name: (stepIdsByName.get(name)?.size ?? 0) > 1 ? `${name} (${step.step_id})` : name,
        value: step,
      }];
    }));
  const inputs = (def: WorkflowDefinition) =>
    new Map((def.inputs ?? []).map((input) => [input.name, { name: input.name, value: input }]));
  const outputs = (def: WorkflowDefinition) =>
    new Map(Object.entries(def.outputs ?? {}).map(([name, value]) => [name, { name, value }]));
  const changes = [
    ...compareEntries('Step', steps(before), steps(after)),
    ...compareEntries('Input', inputs(before), inputs(after)),
    ...compareEntries('Output', outputs(before), outputs(after)),
  ];
  for (const [name, previous, next] of [
    ['Name', before.name, after.name],
    ['Approval policy', before.policy, after.policy],
    ['Run limits', before.limits, after.limits],
    ['Canvas layout', before.ui?.positions ?? {}, after.ui?.positions ?? {}],
  ] as const) {
    if (comparable(previous) !== comparable(next)) {
      changes.push({
        section: 'Workflow',
        name,
        action: 'Changed',
        details: changedFields(previous, next),
      });
    }
  }
  for (const [name, entries] of [['Step order', steps], ['Input order', inputs]] as const) {
    const previous = entries(before);
    const next = entries(after);
    const previousOrder = [...previous.keys()].filter((id) => next.has(id));
    const currentOrder = [...next.keys()].filter((id) => previous.has(id));
    if (JSON.stringify(previousOrder) !== JSON.stringify(currentOrder)) {
      changes.push({
        section: 'Workflow',
        name,
        action: 'Changed',
        details: { from: previousOrder, to: currentOrder },
      });
    }
  }
  return changes;
}

export function WorkflowVersionCompare({ id, name, initialFrom, initialTo, onClose }: {
  id: string;
  name: string;
  initialFrom?: number;
  initialTo?: number;
  onClose: () => void;
}) {
  const query = useGetWorkflowVersionsQuery(id, { refetchOnMountOrArgChange: true });
  const versions = [...(query.currentData?.versions ?? [])].sort((a, b) => b.version - a.version);
  const [fromVersion, setFromVersion] = useState<number | undefined>(initialFrom);
  const [toVersion, setToVersion] = useState<number | undefined>(initialTo);
  const [filter, setFilter] = useState('all');
  const from = fromVersion === undefined ? versions[1] : versions.find((row) => row.version === fromVersion);
  const to = toVersion === undefined ? versions[0] : versions.find((row) => row.version === toVersion);
  const sameVersion = from?.version === to?.version;
  const changes = from && to && !sameVersion ? compareDefinitions(from.definition, to.definition) : [];
  const actions = [...new Set(changes.map(({ action }) => action))];
  const visibleChanges = actions.some((action) => action === filter)
    ? changes.filter(({ action }) => action === filter) : changes;

  return (
    <ModalDialog label="Compare versions" wide onClose={onClose}>
      <h2>Compare versions</h2>
      <dl className="run-plan-routes" aria-label="Workflow being compared">
        <div><dt>Workflow</dt><dd>{name}</dd></div>
        {name !== id && <div><dt>Workflow ID</dt><dd>{id}</dd></div>}
      </dl>
      {query.isFetching ? (
        <p role="status">Loading versions…</p>
      ) : query.isError ? (
        <div role="alert">
          <p>Could not load versions.</p>
          <button type="button" className="btn" onClick={() => void query.refetch()}>Retry</button>
        </div>
      ) : versions.length < 2 ? (
        <p>Save two versions to compare them.</p>
      ) : (
        <>
          <div className="version-compare-fields">
            <label>From version
              <select value={from?.version ?? fromVersion} onChange={(event) => {
                setFromVersion(Number(event.target.value));
                setFilter('all');
              }}>
                {!from && <option value={fromVersion} disabled>v{fromVersion} (unavailable)</option>}
                {versions.map((row) => <option key={row.version} value={row.version}>v{row.version} · {row.status}</option>)}
              </select>
            </label>
            <label>To version
              <select value={to?.version ?? toVersion} onChange={(event) => {
                setToVersion(Number(event.target.value));
                setFilter('all');
              }}>
                {!to && <option value={toVersion} disabled>v{toVersion} (unavailable)</option>}
                {versions.map((row) => <option key={row.version} value={row.version}>v{row.version} · {row.status}</option>)}
              </select>
            </label>
          </div>
          <button
            type="button"
            className="btn"
            disabled={sameVersion || !from || !to}
            onClick={() => {
              if (!from || !to) return;
              setFromVersion(to.version);
              setToVersion(from.version);
              if (filter === 'Added') setFilter('Removed');
              else if (filter === 'Removed') setFilter('Added');
            }}
          >
            Swap versions
          </button>
          {!from || !to ? (
            <p role="status">Choose another version. One of the selected versions is unavailable.</p>
          ) : sameVersion ? (
            <p role="status">Choose two different versions to compare.</p>
          ) : changes.length === 0 ? (
            <p role="status">No changes to steps, inputs, outputs, settings, or canvas layout.</p>
          ) : (
            <>
              {actions.length > 1 ? (
                <label className="field">
                  <span>Show changes</span>
                  <select value={visibleChanges === changes ? 'all' : filter} onChange={(event) => setFilter(event.target.value)}>
                    <option value="all">All ({changes.length})</option>
                    {actions.map((action) => (
                      <option key={action} value={action}>{action} ({changes.filter((change) => change.action === action).length})</option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="status-line" role="status">
                  {changes.length} {changes.length === 1 ? 'change' : 'changes'}
                </p>
              )}
              <ul key={`${from.version}:${to.version}:${filter}`} className="version-comparison" aria-label="Version changes">
                {visibleChanges.map(({ section, name: entryName, action, details }, index) => (
                  <li key={index}>
                    <strong>{action}</strong>
                    <span>{section} · {entryName}</span>
                    {details && (
                      <details className="version-change-details">
                        <summary>Show changes for {entryName}</summary>
                        <div className="version-change-values">
                          <section aria-label={`From v${from.version}`}>
                            <h3>From v{from.version}</h3>
                            <pre tabIndex={0} aria-label={`Configuration from v${from.version}`}>
                              {JSON.stringify(details.from, null, 2) ?? 'Not set'}
                            </pre>
                          </section>
                          <section aria-label={`To v${to.version}`}>
                            <h3>To v{to.version}</h3>
                            <pre tabIndex={0} aria-label={`Configuration from v${to.version}`}>
                              {JSON.stringify(details.to, null, 2) ?? 'Not set'}
                            </pre>
                          </section>
                        </div>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
    </ModalDialog>
  );
}
