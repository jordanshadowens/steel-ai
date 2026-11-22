export function completeWithConfiguredProvider(
  env: NodeJS.ProcessEnv,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  signal?: AbortSignal,
): Promise<{ kind: 'ok'; text: string } | { kind: 'config-error' } | { kind: 'provider-error' }>;
