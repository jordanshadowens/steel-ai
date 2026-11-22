import { configHome, loadConfig, resolveSecret } from '../../packages/connector/src/config.ts';
import { chatCompletions } from '../../packages/connector/src/provider.ts';

export async function completeWithConfiguredProvider(env, messages) {
  const home = env.STEEL_CONNECTOR_HOME || configHome();
  let config;
  let apiKey;
  try {
    config = loadConfig(home, env);
    apiKey = config.provider_key_ref ? resolveSecret(config.provider_key_ref, home, env) : null;
  } catch {
    return { kind: 'config-error' };
  }
  try {
    const text = await chatCompletions({
      base: config.provider_base,
      model: config.provider_model,
      apiKey,
      messages,
      maxTokens: 4096,
      timeoutMs: config.provider_timeout_ms,
    });
    return { kind: 'ok', text };
  } catch {
    return { kind: 'provider-error' };
  }
}
