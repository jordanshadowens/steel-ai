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
  verification?: Verification;
};
export type Trace = {trace_id: string; span_id: string; parent_span_id?: string};
export type Verification = {status: string; method?: string; expected?: unknown; observed?: unknown; timestamp?: string};
export type MonitoredAgent = { id: string; name: string; runs: AgentRun[]; sourceAvailable?: boolean;
  nextPageToken?: string; schedule?: {state?: string; next?: string} };
export type Checkpoint = {
  id: string;
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
type StepsQuery = { agentId: string; runId: string; pageToken?: string; latest?: boolean };
const path = '/observability/agent-runs';
const api = steelApi.injectEndpoints({
  endpoints: build => ({
    listAgentRuns: build.query<{agents: MonitoredAgent[]}, {agent: string; pageToken: string} | void>({
      query: params => ({ url: path, params: params || undefined, timeout: 30000 }),
    }),
    getAgentSteps: build.query<{steps: Checkpoint[]; nextPageToken?: string; workflowRunId?: string}, StepsQuery>({
      query: ({agentId, runId, pageToken, latest}) => ({
        url: path + '/' + encodeURIComponent(agentId) + '/' + encodeURIComponent(runId) + '/steps',
        params: {...(pageToken && {pageToken}), ...(latest && {order:'latest'})},
        timeout: 30000,
      }),
    }),
  }),
});

export const {useListAgentRunsQuery, useGetAgentStepsQuery} = api;
