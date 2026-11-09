export const RUNTIME_TARGETS = {
  local: 'http://127.0.0.1:3100',
  staging: 'https://steel-portal-staging-yl3vqnwyta-uc.a.run.app',
  production: 'https://steel-runtime-fkknoziyhq-uc.a.run.app',
};

export function resolveRuntimeTarget(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const selected = raw === '' ? 'local' : raw;
  const named = RUNTIME_TARGETS[selected];
  const candidate = named ?? selected;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('STEEL_RUNTIME_URL must be local, staging, or production');
  }
  const origin = url.origin;
  if (!Object.values(RUNTIME_TARGETS).includes(origin) || url.pathname !== '/') {
    throw new Error('STEEL_RUNTIME_URL must be local, staging, or production');
  }
  return origin;
}
