import { useState } from 'react';
import type { DesignerMigrationOp, DesignerPublishRefusal, DesignerPublishResult, DesignerTypeDetail, DesignerValidateResult, DesignerVersionRow } from '../api/contracts';

function opText(op: DesignerMigrationOp): string {
  switch (op.op) {
    case 'type_renamed':
      return `renamed ${String(op.from)} → ${String(op.to)}`;
    case 'field_added':
      return `+ field ${String(op.name)} (${String(op.ftype)})`;
    case 'field_changed':
      return `~ field ${String(op.name)} [${(op.keys ?? []).join(', ')}]`;
    case 'field_removed':
      return `− field ${String(op.name)}`;
    case 'relationship_added':
      return `+ relationship ${String(op.name)}`;
    case 'relationship_changed':
      return `~ relationship ${String(op.name)} [${(op.keys ?? []).join(', ')}]`;
    case 'relationship_removed':
      return `− relationship ${String(op.name)}`;
    case 'rollback':
      return `rollback v${String(op.from)} → v${String(op.to)}`;
    default:
      return op.op;
  }
}

export interface PublishPanelProps {
  detail: DesignerTypeDetail;
  versions: DesignerVersionRow[];
  validateResult: DesignerValidateResult | null;
  validating: boolean;
  validateError: string | null;
  publishing: boolean;
  publishResult: DesignerPublishResult | null;
  publishRefusal: DesignerPublishRefusal | null;
  rollingBack: boolean;
  diffOps: DesignerMigrationOp[] | null;
  diffLoading: boolean;
  onValidate: () => void;
  onPublish: (opts: { backfill: Record<string, unknown>; acknowledgeDestructive: boolean }) => void;
  onRollback: (to_version: number) => void;
  onDiff: (from: number, to: number) => void;
}

export function PublishPanel(props: PublishPanelProps) {
  const [backfills, setBackfills] = useState<Record<string, string>>({});
  const [ack, setAck] = useState(false);
  const [diffFrom, setDiffFrom] = useState('');
  const [diffTo, setDiffTo] = useState('');
  const [rollbackTo, setRollbackTo] = useState('');
  const { detail } = props;

  const gaps = props.publishRefusal?.report?.violations?.filter((v) => v.code === 'required-gap') ?? [];
  const gapFields = [...new Set(gaps.map((g) => g.field))];
  const destructive = props.publishRefusal?.report?.destructive ?? [];

  const submitPublish = () => {
    const backfill: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(backfills)) {
      if (v.trim() !== '') backfill[k] = v;
    }
    props.onPublish({ backfill, acknowledgeDestructive: ack });
  };

  return (
    <div>
      <div className="section-card">
        <h2>Draft state</h2>
        <p className="status-line">
          Live version: <strong>v{detail.version}</strong>
          {detail.validated
            ? detail.validated.current
              ? detail.validated.ok
                ? <span className="status-ok"> · draft validated ✓</span>
                : <span className="status-bad"> · draft invalid (see errors)</span>
              : <span className="status-warn"> · draft changed since last check</span>
            : ' · never checked'}
        </p>
        <div className="toolbar">
          <button type="button" className="btn" disabled={props.validating} onClick={props.onValidate}>
            Check draft
          </button>
        </div>
        {props.validateError && (
          <p className="field-error" role="alert">
            {props.validateError}
          </p>
        )}
        {props.validateResult && !props.validateResult.ok && (
          <ul>
            {props.validateResult.errors.map((e, i) => (
              <li key={i} className="field-error">
                {e.message}
              </li>
            ))}
          </ul>
        )}
        {props.validateResult?.ok && <p className="status-ok status-line">Draft is valid. Publishing still re-checks every record.</p>}
      </div>

      <div className="section-card">
        <h2>Publish</h2>
        <p className="status-line">Freezes this draft as the next immutable version and migrates existing records. Nothing applies before you confirm.</p>
        {gapFields.length > 0 && (
          <div className="panel-card">
            <h3>Backfill required</h3>
            <p className="status-line">These newly-required fields lack values. Supply each one explicitly — the system never invents business values.</p>
            {gapFields.map((f) => (
              <label key={f} className="field">
                <span>{f}</span>
                <input type="text" value={backfills[f] ?? ''} onChange={(e) => setBackfills((prev) => ({ ...prev, [f]: e.target.value }))} disabled={props.publishing} />
              </label>
            ))}
          </div>
        )}
        {destructive.length > 0 && (
          <div className="panel-card">
            <h3>Destructive changes ({destructive.length})</h3>
            <ul>
              {destructive.map((d, i) => (
                <li key={i}>
                  <code>{opText(d)}</code> — {d.reason}
                </li>
              ))}
            </ul>
            <label className="status-line">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={props.publishing} /> I reviewed these changes
            </label>
          </div>
        )}
        <div className="toolbar">
          <button type="button" className="btn btn-primary" disabled={props.publishing} onClick={submitPublish}>
            Publish new version
          </button>
        </div>
        {props.publishRefusal && (
          <div role="alert">
            <p className="field-error">{props.publishRefusal.error}</p>
            {!!props.publishRefusal.report?.violations?.length && (
              <ul>
                {props.publishRefusal.report.violations.slice(0, 10).map((v, i) => (
                  <li key={i} className="field-error">
                    {v.field}: {v.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {props.publishResult && (
          <p className="status-ok status-line">
            Published v{props.publishResult.version}: {props.publishResult.ops.length} ops, {props.publishResult.records_checked} records checked
            {props.publishResult.backfilled > 0 ? `, ${props.publishResult.backfilled} backfilled` : ''}
            {props.publishResult.backup_path ? ', backup taken' : props.publishResult.backup_note ? ` (${props.publishResult.backup_note})` : ''}.
          </p>
        )}
      </div>

      <div className="section-card">
        <h2>Versions</h2>
        {props.versions.length === 0 && <p className="status-line">No published versions yet.</p>}
        <table className="grid">
          <thead>
            <tr>
              <th scope="col">Version</th>
              <th scope="col">Status</th>
              <th scope="col">Published</th>
            </tr>
          </thead>
          <tbody>
            {props.versions.map((v) => (
              <tr key={v.version}>
                <td className="num">v{v.version}</td>
                <td>{v.status}</td>
                <td>{v.published_at ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {props.versions.length >= 1 && (
          <form
            className="toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              const from = Number(diffFrom);
              const to = Number(diffTo);
              if (Number.isInteger(from) && Number.isInteger(to)) props.onDiff(from, to);
            }}
          >
            <label className="status-line">
              From{' '}
              <input type="text" inputMode="numeric" aria-label="Diff from version" value={diffFrom} onChange={(e) => setDiffFrom(e.target.value)} size={4} />
            </label>
            <label className="status-line">
              To{' '}
              <input type="text" inputMode="numeric" aria-label="Diff to version" value={diffTo} onChange={(e) => setDiffTo(e.target.value)} size={4} />
            </label>
            <button type="submit" className="btn" disabled={props.diffLoading}>
              Show diff
            </button>
          </form>
        )}
        {props.diffOps && (
          <ul>
            {props.diffOps.length === 0 && <li className="status-line">No structural differences.</li>}
            {props.diffOps.map((o, i) => (
              <li key={i}>
                <code>{opText(o)}</code>
              </li>
            ))}
          </ul>
        )}
        {props.versions.length >= 2 && (
          <form
            className="toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              const to = Number(rollbackTo);
              if (Number.isInteger(to)) props.onRollback(to);
            }}
          >
            <label className="status-line">
              Roll back to v
              <input type="text" inputMode="numeric" aria-label="Rollback to version" value={rollbackTo} onChange={(e) => setRollbackTo(e.target.value)} size={4} />
            </label>
            <button type="submit" className="btn btn-danger" disabled={props.rollingBack}>
              Roll back
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
