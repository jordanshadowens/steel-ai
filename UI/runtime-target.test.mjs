import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRuntimeTarget } from './runtime-target.mjs';

test('the client uses the public API domain', () => {
  assert.equal(resolveRuntimeTarget(''), 'https://api.steelai.dev');
  assert.equal(resolveRuntimeTarget('https://api.steelai.dev'), 'https://api.steelai.dev');
  assert.throws(() => resolveRuntimeTarget('https://example.com'), /STEEL_RUNTIME_URL/);
  assert.throws(() => resolveRuntimeTarget('http://10.0.0.8:3100'), /STEEL_RUNTIME_URL/);
});
