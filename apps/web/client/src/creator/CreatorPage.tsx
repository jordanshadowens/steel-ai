import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'react-redux';
import type { RootState } from '../store/store';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { AnimatePresence } from 'motion/react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  isDirty,
  openDefinition,
  redo,
  selectStep,
  setPanel,
  undo,
  updateDraft,
} from '../store/workflowEditor';
import { END_NODE_ID, blankDefinition, withPositions, workflowCheckKey } from './adapter';
import { CommandBar } from './CommandBar';
import type { ValidationReport } from './CommandBar';
import { GraphCanvas, graphViewPadding } from './GraphCanvas';
import { Palette, usePaletteDrop } from './Palette';
import type { PaletteDrag } from './Palette';
import { Inspector } from './Inspector';
import { IssueDrawer } from './IssueDrawer';
import { WorkflowAssist } from './WorkflowAssist';
import { NoticeProvider } from './notices';
import { useListSkillsQuery } from '../api/steelApi';
import { findStep } from './stepConfigs';
import { runPreflight } from './preflight';
import type { PreflightIssue } from './preflight';
import './creator.css';

const LibraryPanel = lazy(() => import('./LibraryPanel').then(
  ({ LibraryPanel }) => ({ default: LibraryPanel }),
  () => ({ default: UnavailableLibrary }),
));

function LibraryStatus({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <aside className="overlay-panel overlay-left workflow-library" aria-label="Workflow library">
      <div className="drawer-head">
        <h2>Workflows</h2>
        <button type="button" className="btn" aria-label="Close library" onClick={onClose}>×</button>
      </div>
      <p role="status">{children}</p>
    </aside>
  );
}

function UnavailableLibrary({ onClose }: { onClose: () => void }) {
  return <LibraryStatus onClose={onClose}>Couldn’t load the workflow library. Close this panel and save your edits before reloading.</LibraryStatus>;
}

// Full-screen Creator: the canvas is the base layer; the command bar sits
// above it and every utility overlays it. No document-level scrolling.
export function CreatorPage() {
  const [noticeTarget, setNoticeTarget] = useState<HTMLDivElement | null>(null);
  return (
    <NoticeProvider target={noticeTarget}>
      <ReactFlowProvider>
        <CreatorWorkspace setNoticeTarget={setNoticeTarget} />
      </ReactFlowProvider>
    </NoticeProvider>
  );
}

function CreatorWorkspace({ setNoticeTarget }: { setNoticeTarget: (target: HTMLDivElement | null) => void }) {
  const dispatch = useAppDispatch();
  const flow = useReactFlow();
  const canvas = useRef<HTMLDivElement>(null);
  const attachCanvas = useCallback((element: HTMLDivElement | null) => {
    canvas.current = element;
    setNoticeTarget(element);
  }, [setNoticeTarget]);
  const panFrame = useRef<number | null>(null);
  const skills = useListSkillsQuery();
  const draft = useAppSelector((s) => s.workflowEditor.draft);
  const dirty = isDirty(useAppSelector((s) => s.workflowEditor));
  const panel = useAppSelector((s) => s.workflowEditor.panel);
  const selectedStepId = useAppSelector((s) => s.workflowEditor.selectedStepId);
  const openSequence = useAppSelector((s) => s.workflowEditor.openSequence);
  const openVersion = useAppSelector((s) => s.workflowEditor.openVersion);
  const needsSetup = !!draft && openVersion === null;
  const wasSettingUp = useRef(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const libraryTrigger = useRef<HTMLButtonElement>(null);
  const closeLibrary = useCallback(() => {
    setLibraryOpen(false);
    libraryTrigger.current?.focus({ preventScroll: true });
    window.requestAnimationFrame(() => {
      if (document.activeElement?.closest('.workflow-library')) {
        libraryTrigger.current?.focus({ preventScroll: true });
      }
    });
  }, []);
  const reduxStore = useStore<RootState>();
  const [issuesOpen, setIssuesOpen] = useState(false);
  const issuesButton = useRef<HTMLButtonElement>(null);
  const observedDraft = useMemo(
    () => draft ? JSON.stringify([openSequence, workflowCheckKey(draft)]) : null,
    [draft, openSequence],
  );
  const [validation, setValidation] = useState<{
    key: string | null;
    report: ValidationReport;
  } | null>(null);
  const report = validation?.key === observedDraft ? validation?.report ?? null : null;
  const validationStatus = report === null ? null : report.valid ? 'valid' : 'invalid';
  const [bodySel, setBodySel] = useState<{ loop: string; step: string } | null>(
    null,
  );
  const paletteDrag = useRef<PaletteDrag | null>(null);
  const drop = usePaletteDrop(paletteDrag);
  useEffect(() => () => {
    if (panFrame.current !== null) window.cancelAnimationFrame(panFrame.current);
  }, [openSequence]);
  useEffect(() => {
    if (needsSetup) {
      setBodySel(null);
      dispatch(setPanel('settings'));
    } else if (wasSettingUp.current) {
      dispatch(setPanel('none'));
    }
    wasSettingUp.current = needsSetup;
  }, [needsSetup, dispatch]);
  useEffect(() => {
    setValidation(null);
    setIssuesOpen(false);
    setBodySel(null);
  }, [openSequence]);
  useEffect(() => {
    if (!draft) return;
    if (selectedStepId && selectedStepId !== END_NODE_ID && !findStep(draft, selectedStepId, null)) {
      dispatch(selectStep(null));
    }
    if (bodySel && !findStep(draft, bodySel.step, bodySel.loop)) {
      setBodySel(null);
    }
  }, [draft, selectedStepId, bodySel, dispatch]);
  // Incomplete drafts are expected while editing. Keep checks available on
  // demand rather than announcing the entire workflow after each change.
  const steps = draft?.steps;
  const inputs = draft?.inputs;
  const outputs = draft?.outputs;
  const liveChecks = useMemo(
    () => runPreflight({ steps, inputs, outputs }, skills.data?.skills ?? []),
    [steps, inputs, outputs, skills.data],
  );
  const visibleReport = report ?? {
    serverErrors: [],
    preflight: liveChecks,
    valid: liveChecks.length === 0,
  };
  const issueCount =
    visibleReport.serverErrors.length + visibleReport.preflight.length;
  const stepIssues = useMemo(() => {
    const counts = new Map<string, { errors: number; warnings: number }>();
    for (const issue of report?.preflight ?? liveChecks) {
      if (!issue.stepId) continue;
      const count = counts.get(issue.stepId) ?? { errors: 0, warnings: 0 };
      if (issue.severity === 'error') count.errors += 1;
      else count.warnings += 1;
      counts.set(issue.stepId, count);
    }
    return counts;
  }, [report, liveChecks]);

  useEffect(() => {
    // Commit buffered text before the canvas or navigation changes selection.
    // Canvas pointer handlers may otherwise unmount the field before blur.
    const commitFocusedField = (e?: PointerEvent) => {
      const active = document.activeElement;
      if (
        !(
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement
        )
      ) {
        return;
      }
      if (!active.closest('.creator') || (e && e.target === active)) {
        return;
      }
      active.blur();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      commitFocusedField();
      if (dirty) {
        e.preventDefault();
      }
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
      if (e.defaultPrevented || e.isComposing) return;
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;
      // Keyboard alternative to dragging: move the selected node precisely.
      if (
        !needsSetup &&
        !typing &&
        (target === document.body || target.closest('.react-flow')) &&
        !target.closest('button, a, [role="menuitem"]') &&
        selectedStepId &&
        selectedStepId !== END_NODE_ID &&
        draft &&
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)
      ) {
        e.preventDefault();
        const step =
          (e.shiftKey ? 1 : 10) *
          (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
        const cur = draft.ui?.positions?.[selectedStepId] ?? { x: 0, y: 0 };
        const dx = e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' || e.key === 'ArrowDown' ? step : 0;
        dispatch(
          updateDraft(
            withPositions(draft, {
              [selectedStepId]: { x: cur.x + dx, y: cur.y + dy },
            }),
          ),
        );
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
        if (libraryOpen) {
          e.preventDefault();
          closeLibrary();
        } else if (needsSetup) {
          return;
        } else if (issuesOpen) {
          setIssuesOpen(false);
        } else if (bodySel) {
          setBodySel(null);
        } else if (selectedStepId) {
          dispatch(selectStep(null));
        } else if (panel !== 'none') {
          dispatch(setPanel('none'));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    closeLibrary,
    dispatch,
    libraryOpen,
    issuesOpen,
    bodySel,
    selectedStepId,
    panel,
    draft,
    needsSetup,
  ]);

  const inspectorVisible =
    panel === 'inspector' ||
    panel === 'settings' ||
    selectedStepId !== null ||
    bodySel !== null;

  function afterInspectorOpens(onFocused?: () => void, fieldSelector?: string) {
    if (panFrame.current !== null) window.cancelAnimationFrame(panFrame.current);
    const previousFocus = document.activeElement;
    const openedFromDialog = document.querySelector('[aria-modal="true"]');
    panFrame.current = window.requestAnimationFrame(() => {
      panFrame.current = null;
      const focus = document.activeElement;
      if ((openedFromDialog || focus === previousFocus || focus === document.body) && !document.querySelector('[aria-modal="true"]')) {
        const field = fieldSelector ? canvas.current?.querySelector<HTMLElement>(fieldSelector) : null;
        const target = field ?? canvas.current?.querySelector<HTMLElement>('.inspector-title h2');
        target?.focus({ preventScroll: true });
        field?.scrollIntoView({ block: 'nearest' });
      }
      onFocused?.();
    });
  }

  function openLibrary(trigger: HTMLButtonElement) {
    libraryTrigger.current = trigger;
    setLibraryOpen(true);
  }

  function openSettings(inputIndex?: number, inputField = 'name', focusWorkflowId = false) {
    setBodySel(null);
    setIssuesOpen(false);
    dispatch(setPanel('settings'));
    const field = focusWorkflowId ? '#creator-workflow-id'
      : inputIndex === undefined ? undefined : `[aria-label="Input ${inputIndex + 1} ${inputField}"]`;
    afterInspectorOpens(undefined, field);
  }

  function goToStep(id: string, bodyStep?: string, outputName?: string, routeField?: PreflightIssue['routeField']) {
    setBodySel(bodyStep ? { loop: id, step: bodyStep } : null);
    setIssuesOpen(false);
    dispatch(selectStep(id));
    afterInspectorOpens(() => {
      void flow.fitView({
        nodes: [{ id }],
        padding: graphViewPadding(canvas.current),
        maxZoom: 1,
        duration: 180,
      });
    }, routeField ? `#creator-route-${routeField}`
      : outputName === undefined ? undefined : `[data-output-name="${CSS.escape(outputName)}"] input`);
  }

  return (
    <div className="creator">
      {draft && (
        <CommandBar
          key={openSequence}
          onOpenLibrary={openLibrary}
          onOpenSettings={(focusWorkflowId) => openSettings(undefined, undefined, focusWorkflowId)}
          onGoToInput={openSettings}
          onGoToStep={goToStep}
          validationStatus={validationStatus}
          onValidated={(report, reveal = true) => {
            const current = reduxStore.getState().workflowEditor;
            if (!current.draft) return;
            const key = JSON.stringify([current.openSequence, workflowCheckKey(current.draft)]);
            setValidation({ key, report });
            if (reveal) setIssuesOpen(!report.valid || report.preflight.length > 0);
          }}
        />
      )}
      <div className="creator-canvas" ref={attachCanvas} {...(needsSetup ? {} : drop)}>
        {draft ? (
          needsSetup ? (
            <div className="canvas-empty setup-message">
              <strong>Set up your workflow</strong>
              <p>Enter a workflow ID and save the draft to add steps.</p>
            </div>
          ) : (
            <GraphCanvas
              key={openSequence}
              stepIssues={stepIssues}
              onGoToStep={goToStep}
            />
          )
        ) : (
          <div className="canvas-empty creator-start">
            <div className="creator-start-card">
              <h1>Workflow Creator</h1>
              <div className="creator-start-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    dispatch(openDefinition({
                      workflowId: '',
                      version: null,
                      status: 'new',
                      definition: blankDefinition(),
                    }))
                  }
                >
                  New workflow
                </button>
                <button type="button" className="btn" onClick={(event) => openLibrary(event.currentTarget)}>
                  Open workflow
                </button>
              </div>
            </div>
          </div>
        )}
        {draft && !needsSetup && <Palette onInserted={goToStep} drag={paletteDrag} />}
        <WorkflowAssist />
        <AnimatePresence>
          {libraryOpen && (
            <Suspense key="lib" fallback={
              <LibraryStatus onClose={closeLibrary}>Loading workflows…</LibraryStatus>
            }>
              <LibraryPanel onClose={closeLibrary} />
            </Suspense>
          )}
          {(inspectorVisible || needsSetup) && draft && (
            <Inspector
              key={`inspector-${openSequence}`}
              bodySel={bodySel}
              setBodySel={setBodySel}
              requiredSetup={needsSetup}
              onGoToStep={goToStep}
            />
          )}
        </AnimatePresence>
        <IssueDrawer
          report={visibleReport}
          serverChecked={report !== null}
          open={issuesOpen}
          onClose={() => setIssuesOpen(false)}
          getFallbackFocus={() => issuesButton.current}
          onGoToStep={(id, bodyStep, routeField) => goToStep(id, bodyStep, undefined, routeField)}
          onGoToSettings={() => openSettings()}
          onGoToInput={openSettings}
          onGoToOutput={(name) => goToStep(END_NODE_ID, undefined, name)}
        />
        {issueCount > 0 && !issuesOpen && !needsSetup && (
          <button
            ref={issuesButton}
            type="button"
            className="btn issues-fab"
            onClick={() => setIssuesOpen(true)}
          >
            Issues ({issueCount})
          </button>
        )}
      </div>
    </div>
  );
}
