// SPDX-License-Identifier: Apache-2.0
export class SteelClient {
  constructor({ baseUrl, fetchImpl = globalThis.fetch }) {
    if (!baseUrl || typeof fetchImpl !== 'function') throw new TypeError('baseUrl and fetch implementation required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetch = fetchImpl;
  }
  async request(path, { method = 'GET', body, signal } = {}) {
    const response = await this.fetch(this.baseUrl + path, {
      method, signal, headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Steel API request failed: HTTP ${response.status}`);
    return response.status === 204 ? undefined : response.json();
  }
  health() { return this.request('/health'); }
  workflows() { return this.request('/workflows'); }
  run({ workflow_id, version, inputs }) {
    return this.request('/runs', { method: 'POST', body: { workflow_id, ...(version === undefined ? {} : { version }), inputs } });
  }
  getRun(id) { return this.request('/runs/' + encodeURIComponent(id)); }
}
