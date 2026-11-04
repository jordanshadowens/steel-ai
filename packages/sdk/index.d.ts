export * from './contracts.js';
export declare class SteelClient {
  constructor(options: {baseUrl: string; fetchImpl?: typeof fetch});
  request<T = unknown>(path: string, options?: {method?: string; body?: unknown; signal?: AbortSignal}): Promise<T>;
  health(): Promise<{ok: boolean}>;
  workflows(): Promise<{workflows: import('./contracts.js').WorkflowLibraryRow[]}>;
  run(input: {workflow_id: string; version?: number; inputs: Record<string, unknown>}): Promise<{run_id: string; status: string; outputs?: Record<string, unknown>}>;
  getRun(id: string): Promise<{run: import('./contracts.js').RunRow}>;
}
