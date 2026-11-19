// Reusable SDK surface: everything a developer needs to embed the
// connector loop or build a custom provider adapter.
//
// PUBLIC Apache-2.0 candidate. Zero dependencies.

export {
  PROTOCOL_ID,
  JOB_TYPES,
  LIMITS,
  ERROR_CODES,
  validateJobShape,
  isExpired,
  providerPayloadFor,
} from './protocol.ts';

export {
  configHome,
  loadConfig,
  writeSkeletonConfig,
  storeKeyFile,
  resolveSecret,
  isLoopbackUrl,
  DEFAULT_HOME,
  CONFIG_FILE,
  STEEL_KEY_FILE,
  PROVIDER_KEY_FILE,
} from './config.ts';

export { chatCompletions, probeProvider } from './provider.ts';
export { Connector } from './connector.ts';
