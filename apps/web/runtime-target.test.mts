import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRuntimeTarget } from './runtime-target.mts';

test('the client uses the public API domain', () => {
  assert.equal(resolveRuntimeTarget(''), 'https://api.steelai.dev');
  assert.equal(
    resolveRuntimeTarget('https://api.steelai.dev'),
    'https://api.steelai.dev',
  );
  assert.equal(
    resolveRuntimeTarget(
      'https://steel-portal-staging-yl3vqnwyta-uc.a.run.app',
    ),
    'https://steel-portal-staging-yl3vqnwyta-uc.a.run.app',
  );
  for (const value of [
    'https://steel-portal-staging-yl3vqnwyta-uc.a.run.app.evil.invalid',
    'https://user@api.steelai.dev',
    'https://api.steelai.dev?x=secret',
    'https://api.steelai.dev/#fragment',
  ]) {
    assert.throws(() => resolveRuntimeTarget(value));
  }
  assert.throws(
    () => resolveRuntimeTarget('https://example.com'),
    /STEEL_RUNTIME_URL/,
  );
  assert.throws(
    () => resolveRuntimeTarget('http://10.0.0.8:3100'),
    /STEEL_RUNTIME_URL/,
  );
});
