import { steelApi } from '../api/steelApi';

export type AgentRun = {
  id: string;
  agentId: string;
  timestamp: string;
  status: string;
  workflowRunId?: string;
  started?: string;
  finished?: string;
  duration?: number;
  trigger?: string;
  summary?: string;
  latestStep?: string;
  heartbeatAware?: boolean;
  version?: string;
  workflowVersion?: number;
  verification?: Verification;
};
export type Trace = {trace_id: string; span_id: string; parent_span_id?: string};
export type Verification = {status: string; method?: string; expected?: unknown; observed?: unknown; timestamp?: string};
export type MonitoredAgent = { id: string; name: string; runs: AgentRun[]; sourceAvailable?: boolean;
  nextPageToken?: string; schedule?: {state?: string; next?: string};
  heartbeatExpirySeconds?: number;
  reliability?: 'schedule_overdue' | 'execution_timed_out' | 'heartbeat_expired' | 'completion_checkpoint_missing';
  alertRules?: {executionFailures: number; stepFailures: number; heartbeatExpirySeconds: number; scheduleGraceSeconds?: number};
  alerts?: {code: string; severity: string; executionId?: string; count?: number; at?: string}[] };
export type Checkpoint = {
  id: string;
  executionId?: string;
  timestamp: string;
  step: string;
  severity: string;
  inputs: unknown;
  outputs: unknown;
  reason?: string;
  source?: string;
  status?: string;
  duration?: number;
  attempt?: number;
  eventType?: string;
  trace?: Trace;
  spanLinks?: Trace[];
  verification?: Verification;
  evidenceRefs?: string[];
  error?: {code: string};
};
export type DecisionPage = {steps: Checkpoint[]; evidence?: Checkpoint[]; evidencePartial?: boolean; nextPageToken?: string};
type StepsQuery = { agentId: string; runId: string; pageToken?: string; latest?: boolean };
export type HistorySearch = {execution?: string; status?: string; outcome?: string; version?: string;
  severity?: string; resource?: string; from?: string; to?: string};
const path = '/observability/agent-runs';
const api = steelApi.injectEndpoints({
  endpoints: build => ({
    listAgentRuns: build.query<{agents: MonitoredAgent[]}, ({agent: string; pageToken?: string} & HistorySearch) | void>({
      query: params => ({ url: path, params: params || undefined, timeout: 30000 }),
    }),
    getAgentSteps: build.query<{steps: Checkpoint[]; nextPageToken?: string; workflowRunId?: string}, StepsQuery>({
      query: ({agentId, runId, pageToken, latest}) => ({
        url: path + '/' + encodeURIComponent(agentId) + '/' + encodeURIComponent(runId) + '/steps',
        params: {...(pageToken && {pageToken}), ...(latest && {order:'latest'})},
        timeout: 30000,
      }),
    }),
    getAgentDecisions: build.query<DecisionPage, {agent: string; execution?: string; pageToken?: string}>({
      query: params => ({url:path + '/logs', params:{...params, decisions:'1'}, timeout:15000}),
    }),
  }),
});

export const {useListAgentRunsQuery, useGetAgentStepsQuery, useGetAgentDecisionsQuery} = api;
