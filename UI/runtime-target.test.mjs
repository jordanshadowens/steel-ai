import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRuntimeTarget } from './runtime-target.mjs';

test('the client defaults to this computer and can select either cloud runtime', () => {
  assert.equal(resolveRuntimeTarget(''), 'http://127.0.0.1:3100');
  assert.equal(resolveRuntimeTarget('local'), 'http://127.0.0.1:3100');
  assert.equal(resolveRuntimeTarget('staging'), 'https://steel-portal-staging-yl3vqnwyta-uc.a.run.app');
  assert.equal(resolveRuntimeTarget('production'), 'https://steel-runtime-fkknoziyhq-uc.a.run.app');
  assert.equal(resolveRuntimeTarget('https://steel-runtime-fkknoziyhq-uc.a.run.app'), 'https://steel-runtime-fkknoziyhq-uc.a.run.app');
  assert.throws(() => resolveRuntimeTarget('https://example.com'), /STEEL_RUNTIME_URL/);
  assert.throws(() => resolveRuntimeTarget('http://10.0.0.8:3100'), /STEEL_RUNTIME_URL/);
});
