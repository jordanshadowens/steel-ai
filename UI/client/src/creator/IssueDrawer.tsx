import { motion } from 'motion/react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { selectStep } from '../store/workflowEditor';
import type { ValidationReport } from './CommandBar';
import { useFloatingPanel } from './useFloatingPanel';

// Clickable issue list. Server errors are matched to steps by id mention;
// preflight issues already carry their step.
export function IssueDrawer({ report, open, onClose }: { report: ValidationReport | null; open: boolean; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const floating = useFloatingPanel(open);
  const steps = useAppSelector((s) => s.workflowEditor.draft?.steps ?? []);
  if (!open) return null;

  const ids = steps.map((s) => s.step_id).sort((a, b) => b.length - a.length);
  const stepIn = (message: string): string | null => {
    for (const id of ids) {
      if (message.includes(id)) return id;
    }
    return null;
  };

  const serverErrors = report?.serverErrors ?? [];
  const preflight = report?.preflight ?? [];
  const errorCount = serverErrors.length + preflight.filter((p) => p.severity === 'error').length;
  const warnCount = preflight.filter((p) => p.severity === 'warning').length;

  return (
    <motion.aside
      ref={floating.ref}
      style={floating.style}
      className="drawer"
      role="complementary"
      aria-label="Validation issues"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      <div className="drawer-head panel-drag-handle" {...floating.handle}>
        <h2>Issues</h2>
        <button type="button" className="btn" onClick={onClose} aria-label="Close issues">
          ×
        </button>
      </div>
      <p className="status-line num">
        {errorCount === 0 && warnCount === 0
          ? 'No issues. Definition is valid.'
          : `${errorCount} error${errorCount === 1 ? '' : 's'}, ${warnCount} warning${warnCount === 1 ? '' : 's'}`}
      </p>
      {serverErrors.map((message, i) => (
        <IssueRow key={`s${i}`} message={message} severity="error" source="server" stepId={stepIn(message)} onSelect={(id) => dispatch(selectStep(id))} />
      ))}
      {preflight.map((p, i) => (
        <IssueRow key={`p${i}`} message={p.message} severity={p.severity} source="preflight" stepId={p.stepId} onSelect={(id) => dispatch(selectStep(id))} />
      ))}
    </motion.aside>
  );
}

function IssueRow({ message, severity, source, stepId, onSelect }: { message: string; severity: 'error' | 'warning'; source: string; stepId: string | null; onSelect: (id: string) => void }) {
  const body = (
    <>
      <span className={severity === 'error' ? 'status-bad' : 'status-warn'}>{severity === 'error' ? 'Error' : 'Warning'}</span>
      <span className="status-line"> · {source}</span>
      <div>{message}</div>
    </>
  );
  if (!stepId) return <div className="issue-row">{body}</div>;
  return (
    <button type="button" className="issue-row issue-clickable" title={`Go to step ${stepId}`} onClick={() => onSelect(stepId)}>
      {body}
    </button>
  );
}
