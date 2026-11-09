export const RUNTIME_API = 'https://api.steelai.dev';

export function resolveRuntimeTarget(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const candidate = raw === '' ? RUNTIME_API : raw;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('STEEL_RUNTIME_URL must be https://api.steelai.dev');
  }
  if (url.origin !== RUNTIME_API || url.pathname !== '/') {
    throw new Error('STEEL_RUNTIME_URL must be https://api.steelai.dev');
  }
  return url.origin;
}
