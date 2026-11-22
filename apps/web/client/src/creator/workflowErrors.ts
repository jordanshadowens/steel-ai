export function serverErrorList(err: unknown): string[] {
  if (!err || typeof err !== 'object' || !('data' in err)) return [];
  const data = err.data as { errors?: unknown } | undefined;
  if (!Array.isArray(data?.errors)) return [];
  return data.errors.filter((error): error is string => typeof error === 'string' && error.trim() !== '');
}

export function workflowErrorMessage(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  if ('data' in err && err.data && typeof err.data === 'object' && 'error' in err.data) {
    if (typeof err.data.error === 'string' && err.data.error.trim()) return err.data.error;
  }
  if ('message' in err && typeof err.message === 'string' && err.message.trim()) return err.message;
  return undefined;
}
