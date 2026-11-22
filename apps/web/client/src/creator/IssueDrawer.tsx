import { useEffect, useRef, useState } from 'react';
import * as m from 'motion/react-m';
import { useAppSelector } from '../store/hooks';
import type { WorkflowStep } from '../api/contracts';
import { END_NODE_ID } from './adapter';
import type { ValidationReport } from './CommandBar';
import { useFloatingPanel } from './useFloatingPanel';

type IssueAction = { label: string; open: () => void };
type InputField = 'name' | 'type' | 'required';

export function IssueDrawer({
  report,
  serverChecked,
  open,
  onClose,
  getFallbackFocus,
  onGoToStep,
  onGoToSettings,
  onGoToOutput,
  onGoToInput,
}: {
  report: ValidationReport;
  serverChecked: boolean;
  open: boolean;
  onClose: () => void;
  getFallbackFocus: () => HTMLElement | null;
  onGoToStep: (id: string, bodyStep?: string, routeField?: PreflightIssue['routeField']) => void;
  onGoToSettings: () => void;
  onGoToOutput: (name: string) => void;
  onGoToInput: (index: number, field: InputField) => void;
}) {
  const floating = useFloatingPanel(open);
  const heading = useRef<HTMLHeadingElement>(null);
  const [filter, setFilter] = useState<'all' | 'error' | 'warning'>('all');
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) {
      setFilter('all');
      return;
    }
    if (document.activeElement === heading.current) return;
    const active = document.activeElement;
    returnFocus.current = active instanceof HTMLElement ? active : null;
    heading.current?.focus({ preventScroll: true });
  }, [open]);

  function close() {
    const previous = returnFocus.current;
    onClose();
    if (previous?.isConnected && previous !== document.body) {
      previous.focus({ preventScroll: true });
      return;
    }
    window.requestAnimationFrame(() => {
      if (document.activeElement === document.body) getFallbackFocus()?.focus({ preventScroll: true });
    });
  }
  const steps = useAppSelector((s) => s.workflowEditor.draft?.steps) ?? [];
  const outputs = useAppSelector((s) => s.workflowEditor.draft?.outputs);
  if (!open) {
    return null;
  }

  function stepAction(id: string | null, bodyStep?: string, routeField?: PreflightIssue['routeField']): IssueAction | null {
    if (!id) return null;
    return {
      label: id === END_NODE_ID ? 'Go to Finish' : `Go to step ${bodyStep ?? id}`,
      open: () => onGoToStep(id, bodyStep, routeField),
    };
  }

  const settingsAction = { label: 'Go to Workflow settings', open: onGoToSettings };
  const outputAction = (name: string): IssueAction => ({
    label: `Go to output ${name}`,
    open: () => onGoToOutput(name),
  });
  const inputAction = (index: number, field: InputField = 'name'): IssueAction => ({
    label: `Go to input ${index + 1} ${field}`,
    open: () => onGoToInput(index, field),
  });

  function serverAction(message: string): IssueAction | null {
    const input = /^inputs(?:\[(\d+)\]|\.(\d+))\.(name|type|required)(?::|$)/.exec(message);
    if (input) return inputAction(Number(input[1] ?? input[2]), input[3] as InputField);
    if (/^outputs(?:\.|:|\[)/.test(message)) {
      const names = Object.keys(outputs ?? {}).sort((left, right) => right.length - left.length);
      const output = names.find((name) => {
        const path = `outputs.${name}`;
        return [':', '.', '['].some((suffix) => message.startsWith(`${path}${suffix}`)) ||
          message.startsWith(`outputs[${JSON.stringify(name)}]`);
      });
      return output === undefined ? stepAction(END_NODE_ID) : outputAction(output);
    }
    if (/^(inputs(?:\[|:|\.)|workflow_id\b|policy\b)/.test(message)) {
      return settingsAction;
    }

    const path = /^steps\[(\d+)\]/.exec(message);
    if (path) {
      const step = steps[Number(path[1])];
      if (!step) return null;
      const index = /\.config\.body\[(\d+)\]/.exec(message);
      const config = step.config as { body?: WorkflowStep[] } | undefined;
      const body = index && Array.isArray(config?.body) ? config.body[Number(index[1])] : undefined;
      return stepAction(step.step_id, body?.step_id);
    }

    const tokens = new Set(message.match(/[A-Za-z0-9_-]+/g) ?? []);
    const matches = steps.filter((step) => tokens.has(step.step_id));
    return stepAction(matches.length === 1 ? matches[0].step_id : null);
  }

  const serverErrors = report.serverErrors;
  const editorErrors = report.preflight.filter((issue) => issue.severity === 'error');
  const warnings = report.preflight.filter((issue) => issue.severity === 'warning');
  const errorCount = serverErrors.length + editorErrors.length;
  const warnCount = warnings.length;
  const canFilter = errorCount > 0 && warnCount > 0;
  const activeFilter = canFilter ? filter : 'all';
  const visibleEditorIssues = activeFilter === 'warning' ? warnings
    : activeFilter === 'error' ? editorErrors : [...editorErrors, ...warnings];

  return (
    <m.aside
      ref={floating.ref}
      style={floating.style}
      className="drawer"
      role="complementary"
      aria-label="Validation issues"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        close();
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      <div className="drawer-head panel-drag-handle" {...floating.handle}>
        <h2 ref={heading} tabIndex={-1}>Issues</h2>
        <button
          type="button"
          className="btn"
          onClick={close}
          aria-label="Close issues"
        >
          ×
        </button>
      </div>
      <p className="status-line num" role="status">
        {errorCount === 0 && warnCount === 0
          ? serverChecked ? 'No issues found.' : 'No editor issues found.'
          : `${errorCount} error${errorCount === 1 ? '' : 's'}, ${warnCount} warning${warnCount === 1 ? '' : 's'}`}
      </p>
      {!serverChecked && <p className="status-line">Click Validate to check this draft on the server.</p>}
      {canFilter && (
        <div className="issue-filters" role="group" aria-label="Filter issues">
          {([
            ['all', 'All', errorCount + warnCount],
            ['error', 'Errors', errorCount],
            ['warning', 'Warnings', warnCount],
          ] as const).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              className={activeFilter === value ? 'btn btn-primary' : 'btn'}
              aria-pressed={activeFilter === value}
              onClick={() => setFilter(value)}
            >
              {label} ({count})
            </button>
          ))}
        </div>
      )}
      {activeFilter !== 'warning' && serverErrors.map((message, i) => (
        <IssueRow
          key={`s${i}`}
          message={message}
          severity="error"
          action={serverAction(message)}
        />
      ))}
      {visibleEditorIssues.map(({ severity, message, outputName, inputIndex, destination, stepId, bodyStepId, routeField }, i) => (
        <IssueRow
          key={`${severity}-${i}`}
          message={message}
          severity={severity}
          action={outputName !== undefined
            ? outputAction(outputName)
            : inputIndex !== undefined ? inputAction(inputIndex)
            : destination === 'settings' ? settingsAction : stepAction(stepId, bodyStepId, routeField)}
        />
      ))}
    </m.aside>
  );
}

function IssueRow({
  message,
  severity,
  action,
}: {
  message: string;
  severity: 'error' | 'warning';
  action: IssueAction | null;
}) {
  const body = (
    <>
      <span className={severity === 'error' ? 'status-bad' : 'status-warn'}>
        {severity === 'error' ? 'Error' : 'Warning'}
      </span>
      <div>{message}</div>
    </>
  );
  if (!action) {
    return <div className="issue-row">{body}</div>;
  }
  return (
    <button
      type="button"
      className="issue-row issue-clickable"
      title={action.label}
      aria-label={`${severity === 'error' ? 'Error' : 'Warning'}. ${message} ${action.label}`}
      onClick={action.open}
    >
      {body}
    </button>
  );
}
import type { PreflightIssue } from './preflight';
