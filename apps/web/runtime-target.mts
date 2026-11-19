export const RUNTIME_API = 'https://api.steelai.dev';
export const STAGING_API =
  'https://steel-portal-staging-yl3vqnwyta-uc.a.run.app';

export function resolveRuntimeTarget(value: unknown) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const candidate = raw === '' ? RUNTIME_API : raw;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(
      'STEEL_RUNTIME_URL must be the production or staging runtime',
    );
  }
  if (
    ![RUNTIME_API, STAGING_API].includes(url.origin) ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(
      'STEEL_RUNTIME_URL must be the production or staging runtime',
    );
  }
  return url.origin;
}
