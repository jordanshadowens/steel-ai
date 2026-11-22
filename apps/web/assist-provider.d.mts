export function completeWithConfiguredProvider(
  env: NodeJS.ProcessEnv,
  messages: { role: 'system' | 'user'; content: string }[],
): Promise<{ kind: 'ok'; text: string } | { kind: 'config-error' } | { kind: 'provider-error' }>;
