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
  nextPageToken?: string; schedule?: {state?: string; next?: string};
  reliability?: 'schedule_overdue' | 'execution_timed_out' | 'heartbeat_expired';
  alerts?: {code: string; severity: string; executionId?: string; count?: number}[] };
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
type SignalStatus = 'available' | 'partial' | 'unavailable';
type SignalCoverage = {status: SignalStatus; observed_minutes: number};
export type GoldenSignals = {
  resource_status: 'supported' | 'unsupported';
  service?: string;
  revision?: string;
  window_start?: string;
  window_end?: string;
  expected_minutes: number;
  latency: SignalCoverage & {ok_p95_ms: number | null; error_p95_ms: number | null};
  traffic: SignalCoverage & {requests_per_second: number | null; request_count: number | null};
  saturation: {status: SignalStatus; cpu_observed_minutes: number; memory_observed_minutes: number;
    cpu_p95_percent: number | null; memory_p95_percent: number | null};
  errors: SignalCoverage & {error_percent: number | null; error_count: number | null; request_count: number | null};
};
type AgentSteps = {steps: Checkpoint[]; nextPageToken?: string; workflowRunId?: string; goldenSignals?: GoldenSignals | null};
type StepsQuery = { agentId: string; runId: string; pageToken?: string; latest?: boolean };
const path = '/observability/agent-runs';
const api = steelApi.injectEndpoints({
  endpoints: build => ({
    listAgentRuns: build.query<{agents: MonitoredAgent[]}, {agent: string; pageToken: string} | void>({
      query: params => ({ url: path, params: params || undefined, timeout: 30000 }),
    }),
    getAgentSteps: build.query<AgentSteps, StepsQuery>({
      query: ({agentId, runId, pageToken, latest}) => ({
        url: path + '/' + encodeURIComponent(agentId) + '/' + encodeURIComponent(runId) + '/steps',
        params: {...(pageToken && {pageToken}), ...(latest && {order:'latest'})},
        timeout: 30000,
      }),
    }),
  }),
});

export const {useListAgentRunsQuery, useGetAgentStepsQuery} = api;
