import { useState } from 'react';
import type { DesignerImportReport } from '../api/contracts';

export interface ImportExportProps {
  busy: boolean;
  exporting: boolean;
  exportText: string | null;
  importReport: DesignerImportReport | null;
  importDone: { created: Array<{ name: string }>; relationships: number } | null;
  error: string | null;
  onExport: (typesText: string) => void;
  onValidateImport: (docText: string, prefix: string) => void;
  onImport: (docText: string, prefix: string) => void;
}

export function ImportExport(props: ImportExportProps) {
  const [typesText, setTypesText] = useState('');
  const [docText, setDocText] = useState('');
  const [prefix, setPrefix] = useState('');

  return (
    <div>
      <div className="section-card">
        <h2>Export</h2>
        <p className="status-line">Exports the latest published versions as steel-schema/1. Draft-only types are skipped and listed.</p>
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            props.onExport(typesText);
          }}
        >
          <label className="status-line">
            Types (blank = all){' '}
            <input type="text" aria-label="Types to export" placeholder="Book, Author" value={typesText} onChange={(e) => setTypesText(e.target.value)} disabled={props.exporting} />
          </label>
          <button type="submit" className="btn" disabled={props.exporting}>
            Export
          </button>
        </form>
        {props.exportText && (
          <pre className="dump" aria-label="Exported schema">
            {props.exportText}
          </pre>
        )}
      </div>

      <div className="section-card">
        <h2>Import</h2>
        <p className="status-line">Import creates drafts only — never publishes, never overwrites. Collisions refuse unless a prefix resolves every one.</p>
        <label className="field">
          <span>Schema JSON</span>
          <textarea rows={6} aria-label="Schema JSON to import" value={docText} onChange={(e) => setDocText(e.target.value)} disabled={props.busy} />
        </label>
        <label className="field">
          <span>Name prefix (optional)</span>
          <input type="text" value={prefix} onChange={(e) => setPrefix(e.target.value)} disabled={props.busy} />
        </label>
        <div className="toolbar">
          <button type="button" className="btn" disabled={props.busy || !docText.trim()} onClick={() => props.onValidateImport(docText, prefix)}>
            Check import
          </button>
          <button type="button" className="btn btn-primary" disabled={props.busy || !docText.trim()} onClick={() => props.onImport(docText, prefix)}>
            Import as drafts
          </button>
        </div>
        {props.importReport && (
          <div className="panel-card">
            <h3>{props.importReport.ok ? 'Ready to import' : 'Import blocked'}</h3>
            {props.importReport.creates.length > 0 && <p className="status-line">Would create: {props.importReport.creates.join(', ')}</p>}
            {props.importReport.conflicts.map((c, i) => (
              <p key={i} className="field-error">
                Conflict {c.name}: {c.reason}
              </p>
            ))}
            {props.importReport.errors.map((e, i) => (
              <p key={i} className="field-error">
                {e.message}
              </p>
            ))}
            {props.importReport.warnings.map((w, i) => (
              <p key={i} className="status-warn status-line">
                {w.name}: {w.warning}
              </p>
            ))}
          </div>
        )}
        {props.importDone && (
          <p className="status-ok status-line">
            Imported {props.importDone.created.length} draft type(s), {props.importDone.relationships} relationship(s).
          </p>
        )}
        {props.error && (
          <p className="field-error" role="alert">
            {props.error}
          </p>
        )}
      </div>
    </div>
  );
}
