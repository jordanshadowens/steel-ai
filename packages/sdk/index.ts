// SPDX-License-Identifier: Apache-2.0
import type { RunRow, WorkflowLibraryRow } from './contracts.ts';
export * from './contracts.ts';

export type FetchImplementation = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export interface ClientOptions {
  baseUrl: string;
  fetchImpl?: FetchImplementation;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

export interface RunInput {
  workflow_id: string;
  version?: number;
  inputs: Record<string, unknown>;
}

export interface RunResponse {
  run_id: string;
  status: string;
  outputs?: Record<string, unknown>;
}

/** HTTP client; responses still require validation by their consumers. */
export class SteelClient {
  private readonly baseUrl: string;
  private readonly fetch: FetchImplementation;

  constructor({ baseUrl, fetchImpl = globalThis.fetch }: ClientOptions) {
    if (!baseUrl || typeof fetchImpl !== 'function') {
      throw new TypeError('baseUrl and fetch implementation required');
    }
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetch = fetchImpl;
  }
  async request<T = unknown>(
    path: string,
    { method = 'GET', body, signal }: RequestOptions = {},
  ): Promise<T | undefined> {
    const response = await this.fetch(this.baseUrl + path, {
      method,
      signal,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new Error(`Steel API request failed: HTTP ${response.status}`);
    }
    return response.status === 204 ? undefined : ((await response.json()) as T);
  }
  health() {
    return this.request<{ ok: boolean }>('/health');
  }
  workflows() {
    return this.request<{ workflows: WorkflowLibraryRow[] }>('/workflows');
  }
  run({ workflow_id, version, inputs }: RunInput) {
    return this.request<RunResponse>('/runs', {
      method: 'POST',
      body: {
        workflow_id,
        ...(version === undefined ? {} : { version }),
        inputs,
      },
    });
  }
  getRun(id: string) {
    return this.request<{ run: RunRow }>('/runs/' + encodeURIComponent(id));
  }
}
