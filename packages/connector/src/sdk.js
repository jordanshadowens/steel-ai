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
} from './protocol.js';

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
} from './config.js';

export { chatCompletions, probeProvider } from './provider.js';
export { Connector } from './connector.js';
