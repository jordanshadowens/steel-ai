import { useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { AnimatePresence } from 'motion/react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { isDirty, redo, selectStep, setPanel, undo, updateDraft } from '../store/workflowEditor';
import { withPositions } from './adapter';
import { CommandBar } from './CommandBar';
import type { ValidationReport } from './CommandBar';
import { GraphCanvas } from './GraphCanvas';
import { LibraryPanel } from './LibraryPanel';
import { Palette, usePaletteDrop } from './Palette';
import { Inspector } from './Inspector';
import { IssueDrawer } from './IssueDrawer';
import { NoticeProvider, useNotify } from './notices';
import { useListSkillsQuery } from '../api/steelApi';
import { runPreflight } from './preflight';
import './creator.css';

// Full-screen Creator: the canvas is the base layer; the command bar sits
// above it and every utility overlays it. No document-level scrolling.
export function CreatorPage() {
  return (
    <NoticeProvider>
      <ReactFlowProvider>
        <CreatorWorkspace />
      </ReactFlowProvider>
    </NoticeProvider>
  );
}

function CreatorWorkspace() {
  const dispatch = useAppDispatch();
  const notify = useNotify();
  const skills = useListSkillsQuery();
  const draft = useAppSelector((s) => s.workflowEditor.draft);
  const dirty = isDirty(useAppSelector((s) => s.workflowEditor));
  const panel = useAppSelector((s) => s.workflowEditor.panel);
  const selectedStepId = useAppSelector((s) => s.workflowEditor.selectedStepId);
  const openWorkflowId = useAppSelector((s) => s.workflowEditor.openWorkflowId);
  const openVersion = useAppSelector((s) => s.workflowEditor.openVersion);
  const needsSetup = !!draft && openVersion === null;
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [validationStatus, setValidationStatus] = useState<'valid' | 'invalid' | null>(null);
  const [bodySel, setBodySel] = useState<{ loop: string; step: string } | null>(null);
  const drop = usePaletteDrop();
  useEffect(() => {
    if (needsSetup) { setBodySel(null); dispatch(setPanel('settings')); }
  }, [needsSetup, dispatch]);
  useEffect(() => { setValidationStatus(null); setReport(null); }, [draft]);
  // Incomplete drafts are expected while editing. Keep checks available on
  // demand rather than announcing the entire workflow after each change.
  const liveChecks = draft ? runPreflight(draft, skills.data?.skills ?? []) : [];
  const visibleReport = report ?? { serverErrors: [], preflight: liveChecks, valid: liveChecks.length === 0 };
  const issueCount = visibleReport.serverErrors.length + visibleReport.preflight.length;

  useEffect(() => {
    // Commit buffered text before the canvas or navigation changes selection.
    // Canvas pointer handlers may otherwise unmount the field before blur.
    const commitFocusedField = (e?: PointerEvent) => {
      const active = document.activeElement;
      if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return;
      if (!active.closest('.creator') || (e && e.target === active)) return;
      active.blur();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      commitFocusedField();
      if (dirty) e.preventDefault();
    };
    document.addEventListener('pointerdown', commitFocusedField, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('pointerdown', commitFocusedField, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
      // Keyboard alternative to dragging: move the selected node precisely.
      if (!needsSetup && !typing && selectedStepId && draft && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const step = (e.shiftKey ? 1 : 10) * (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
        const cur = draft.ui?.positions?.[selectedStepId] ?? { x: 0, y: 0 };
        const dx = e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' || e.key === 'ArrowDown' ? step : 0;
        dispatch(updateDraft(withPositions(draft, { [selectedStepId]: { x: cur.x + dx, y: cur.y + dy } })));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !typing) {
        if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault();
          dispatch(e.shiftKey ? redo() : undo());
          return;
        }
        if (e.key === 'y' || e.key === 'Y') {
          e.preventDefault();
          dispatch(redo());
          return;
        }
      }
      if (e.key === 'Escape' && !typing) {
        if (libraryOpen) setLibraryOpen(false);
        else if (issuesOpen) setIssuesOpen(false);
        else if (bodySel) setBodySel(null);
        else if (selectedStepId) dispatch(selectStep(null));
        else if (panel !== 'none') dispatch(setPanel('none'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, libraryOpen, issuesOpen, bodySel, selectedStepId, panel, draft, needsSetup]);

  const inspectorVisible = panel === 'inspector' || panel === 'settings' || selectedStepId !== null || bodySel !== null;

  return (
    <div className="creator">
      {draft && (
        <CommandBar
          onOpenLibrary={() => setLibraryOpen(true)}
            onOpenSettings={() => { setBodySel(null); dispatch(setPanel('settings')); }}
          validationStatus={validationStatus}
          onValidated={(r) => {
            setReport(r);
            setValidationStatus(r.valid ? 'valid' : 'invalid');
            setIssuesOpen(false);
            if (!r.valid) notify('error', 'Workflow needs attention. Open Issues to review the fields and connections to fix.');
          }}
        />
      )}
      <div className="creator-canvas" {...(needsSetup ? {} : drop)}>
        {draft ? (
          needsSetup ? <div className="canvas-empty setup-message"><strong>Set up your workflow</strong><p>Configure its name, inputs and settings, then click Save to start adding steps.</p></div> : <GraphCanvas workflowKey={`${openWorkflowId}@${openVersion ?? 'new'}`} />
        ) : (
          <div className="canvas-empty">
            <p>Open a workflow to edit its steps on the canvas.</p>
            <button type="button" className="btn btn-primary" onClick={() => setLibraryOpen(true)}>
              Open library
            </button>
          </div>
        )}
        {draft && !needsSetup && <Palette />}
        <AnimatePresence>
          {libraryOpen && <LibraryPanel key="lib" onClose={() => setLibraryOpen(false)} />}
          {(inspectorVisible || needsSetup) && draft && <Inspector key="inspector" bodySel={bodySel} setBodySel={setBodySel} validationStatus={validationStatus} requiredSetup={needsSetup} />}
        </AnimatePresence>
        <IssueDrawer report={visibleReport} open={issuesOpen} onClose={() => setIssuesOpen(false)} />
        {issueCount > 0 && !issuesOpen && !needsSetup && (
          <button type="button" className="btn issues-fab" onClick={() => setIssuesOpen(true)}>
            Issues ({issueCount})
          </button>
        )}
      </div>
    </div>
  );
}
