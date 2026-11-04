import { useEffect, useRef, useState } from 'react';
import { useGetRunQuery } from '../api/steelApi';
import { ApprovalsInbox } from './ApprovalsInbox';

const TERMINAL = new Set(['sealed', 'failed']);
const POLL_CAP = 120;

// Live execution view. Polls only while the run is active, stops on terminal
// states and unmount, and never invents progress for unknown branches.
export function RunMonitor({ runId, onTerminal }: { runId: string; onTerminal: (runId: string) => void }) {
  const [done, setDone] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const polls = useRef(0);
  const query = useGetRunQuery(runId, { pollingInterval: done || timedOut ? 0 : 2000, skipPollingIfUnfocused: true });
  const run = query.data?.run;

  useEffect(() => {
    polls.current += 1;
    if (polls.current > POLL_CAP) {
      setTimedOut(true);
      return;
    }
    if (run && TERMINAL.has(run.status) && !done) {
      setDone(true);
      onTerminal(runId);
    }
  }, [run, runId, done, onTerminal]);

  if (query.isLoading) return <p className="status-line">Starting run…</p>;
  if (query.isError) {
    return (
      <p className="status-line">
        <span className="status-bad">Could not load the run. </span>
        <button type="button" className="btn" onClick={() => query.refetch()}>Retry</button>
      </p>
    );
  }
  if (!run) return null;
  if (timedOut) {
    return <p className="status-line status-warn">Monitoring timed out; the run continues on the server — open it from history.</p>;
  }
  const waiting = run.status === 'waiting_approval' || run.status === 'waiting_skill_approval';
  return (
    <div>
      <p className="status-line num" role="status">
        Status: {run.status} · step: {run.current_step ?? '—'}
      </p>
      {waiting && (
        <>
          <p className="status-line">The run is waiting for a decision:</p>
          <ApprovalsInbox runId={runId} />
        </>
      )}
      {!TERMINAL.has(run.status) && !waiting && <p className="status-line">Running…</p>}
    </div>
  );
}
