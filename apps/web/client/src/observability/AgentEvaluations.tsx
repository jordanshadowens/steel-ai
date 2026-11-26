import { Fragment, useEffect, useState } from 'react';
import { useGetAgentDecisionsQuery, useListAgentRunsQuery, type Checkpoint } from './agentActivityApi';
import { runtime } from './cloud';
import { Timestamp, title } from './ExecutionTimeline';
import { RecordedTable } from './RunData';
import { DecisionEvaluation } from './DecisionEvaluation';
import { evaluatedDecisions } from './DecisionRecords';

type Page = {steps: Checkpoint[]; nextPageToken?: string};
type SkillHistory = {skills:{skill_id:number; name:string; version:number; current_checks:number; current_passed:number;
  prior_checks:number; prior_passed:number}[]};
function SkillComparison() {
  const [history, setHistory] = useState<SkillHistory>();
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const cancel = new AbortController();
    void runtime<SkillHistory>('/skills/observability', cancel.signal).then(result => {
      if (!cancel.signal.aborted) setHistory(result);
    }).catch(() => {if (!cancel.signal.aborted) setUnavailable(true);});
    return () => cancel.abort();
  }, []);
  const rate = (passed: number, checks: number) => checks ? `${passed}/${checks} (${Math.round(passed*100/checks)}%)` : 'Unavailable';
  const change = (skill: SkillHistory['skills'][number]) => {
    if (!skill.prior_checks || !skill.current_checks) return 'Unavailable';
    const points = 100 * (skill.current_passed / skill.current_checks - skill.prior_passed / skill.prior_checks);
    return new Intl.NumberFormat(undefined, {maximumFractionDigits:1, signDisplay:'exceptZero'}).format(points) + ' pp';
  };
  return <div className="run-table-viewport" role="region" aria-label="Verified skill history" tabIndex={0}>
    <table className="run-table" aria-label="Verified skill history">
      <caption>Verified skill executions on declared tests</caption>
      <thead><tr><th scope="col">Skill</th><th scope="col">Version</th><th scope="col">Previous seven days</th>
        <th scope="col">Latest seven days</th><th scope="col">Pass-rate change</th></tr></thead>
      <tbody>{history?.skills.map(skill => <tr key={skill.skill_id}><th scope="row">{skill.name}</th><td>{skill.version}</td>
        <td>{rate(skill.prior_passed,skill.prior_checks)}</td><td>{rate(skill.current_passed,skill.current_checks)}</td>
        <td>{change(skill)}</td></tr>)}
      {!history?.skills.length && <tr><td colSpan={5}>{unavailable ? 'Skill history unavailable.'
        : history ? 'No verified skill outcomes in these windows.' : 'Loading skill history…'}</td></tr>}</tbody>
    </table>
  </div>;
}
export function AgentEvaluations({openExecution}: {openExecution: (agentId: string, runId: string) => void}) {
  const {currentData} = useListAgentRunsQuery();
  const [agent, setAgent] = useState('');
  const [mode, setMode] = useState<'decisions' | 'outcomes'>('decisions');
  const [outcome, setOutcome] = useState('');
  const [page, setPage] = useState<Page>();
  const [cursor, setCursor] = useState<string>();
  const [expanded, setExpanded] = useState<string>();
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const decisions = useGetAgentDecisionsQuery({agent, pageToken:cursor}, {skip:!agent || mode !== 'decisions'});
  const checkedRows = evaluatedDecisions(decisions.currentData);
  useEffect(() => {
    setPage(undefined);
    setError(false);
    if (!agent || mode !== 'outcomes') return;
    const cancel = new AbortController();
    const query = new URLSearchParams({agent, verified:'1'});
    if (outcome) query.set('outcome', outcome);
    if (cursor) query.set('pageToken', cursor);
    void runtime<Page>('/observability/agent-runs/logs?' + query, cancel.signal).then(result => {
      if (!cancel.signal.aborted) setPage(result);
    }).catch(() => {
      if (!cancel.signal.aborted) setError(true);
    });
    return () => cancel.abort();
  }, [agent, outcome, cursor, refresh, mode]);
  function switchMode(next: 'decisions' | 'outcomes') {
    setMode(next);
    setCursor(undefined);
    setExpanded(undefined);
  }
  const nextPage = mode === 'decisions' ? decisions.currentData?.nextPageToken : page?.nextPageToken;
  return <section className="obs-execution" aria-label="Agent evaluations">
    <h2>Evaluations</h2>
    <div className="obs-toolbar">
      <button type="button" className="run-link" aria-pressed={mode === 'decisions'} onClick={() => switchMode('decisions')}>Decision checks</button>
      <button type="button" className="run-link" aria-pressed={mode === 'outcomes'} onClick={() => switchMode('outcomes')}>Outcome verification</button>
      <label>Agent<select value={agent} onChange={event => {setAgent(event.target.value); setCursor(undefined); setExpanded(undefined);}}>
        <option value="">Select an agent</option>
        {currentData?.agents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      {mode === 'outcomes' && <label>Outcome<select value={outcome} onChange={event => {setOutcome(event.target.value); setCursor(undefined);}}>
        <option value="">All recorded outcomes</option>
        {['verified_success','verified_failure','partially_successful','unverified','verification_unavailable','not_applicable'].map(item =>
          <option key={item} value={item}>{title(item)}</option>)}
      </select></label>}
    </div>
    {mode === 'decisions' ? <div className="run-table-viewport" role="region" aria-label="Recorded decision checks" tabIndex={0}>
      <table className="run-table" aria-label="Recorded decision checks">
        <thead><tr>{['Time','Execution','Decision','Policy check','Recorded reason','Evidence'].map(label =>
          <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{checkedRows.map(({event, check}) => <Fragment key={event.id}>
          <tr><td><Timestamp value={event.time} /></td>
            <td>{event.executionId ? <button type="button" className="run-row-button"
              onClick={() => openExecution(agent, event.executionId!)}>{event.executionId}</button> : 'Not recorded'}</td>
            <td>{event.step}</td><td>{check?.message ?? 'Unavailable'}</td><td>{event.why ?? 'Not recorded'}</td>
            <td><button type="button" className="run-link" aria-expanded={expanded === event.id}
              onClick={() => setExpanded(expanded === event.id ? undefined : event.id)}>Evidence</button></td>
          </tr>
          {expanded === event.id && <tr className="obs-evidence"><td colSpan={6}>
            <DecisionEvaluation event={event} check={check} />
          </td></tr>}
        </Fragment>)}
        {decisions.currentData?.evidencePartial && <tr><td colSpan={6}>Some linked evidence is unavailable.</td></tr>}
        {!checkedRows.length && <tr><td colSpan={6} role={decisions.isError ? 'alert' : 'status'}>
          {decisions.isError ? <>Could not read decisions. <button type="button" className="run-link"
            onClick={() => void decisions.refetch()}>Retry</button></>
            : !agent ? 'Select an agent.' : decisions.currentData ? 'No recorded decisions in this page.' : 'Checking recorded decisions…'}
        </td></tr>}</tbody>
      </table>
    </div> : <div className="run-table-viewport" role="region" aria-label="Recorded evaluations" tabIndex={0}>
      <table className="run-table" aria-label="Recorded evaluations">
        <thead><tr>{['Time','Execution','Outcome','Method','Evidence'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{page?.steps.filter(item => item.verification).map(item => <Fragment key={item.id}>
          <tr><td><Timestamp value={item.verification?.timestamp ?? item.timestamp} /></td>
            <td>{item.executionId ? <button type="button" className="run-row-button"
              onClick={() => openExecution(agent, item.executionId!)}>{item.executionId}</button> : 'Not recorded'}</td>
            <td>{title(item.verification?.status)}</td><td>{item.verification?.method ?? 'Not recorded'}</td>
            <td><button type="button" className="run-link" aria-expanded={expanded === item.id}
              onClick={() => setExpanded(expanded === item.id ? undefined : item.id)}>Evidence</button></td></tr>
          {expanded === item.id && <tr><td colSpan={5}><RecordedTable value={{
            expected:item.verification?.expected, observed:item.verification?.observed,
          }} /></td></tr>}
        </Fragment>)}
        {!page?.steps.some(item => item.verification) && <tr><td colSpan={5} role={error ? 'alert' : 'status'}>
          {error ? <>Could not read evaluations. <button type="button" className="run-link" onClick={() => setRefresh(n=>n+1)}>Retry</button></>
            : !agent ? 'Select an agent.' : page ? 'No evaluations recorded for the last 24 hours.' : 'Loading evaluations…'}
        </td></tr>}</tbody>
      </table>
    </div>}
    {nextPage && <button type="button" className="run-link" onClick={() => {setCursor(nextPage); setExpanded(undefined);}}>
      {mode === 'decisions' ? 'Older decisions' : 'Older evaluations'}
    </button>}
    <SkillComparison />
  </section>;
}
