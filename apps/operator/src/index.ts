// @idp/operator — the minimal, deliberately mocked operator console (R6.4). It proxies to the session's
// control API through ControlClient; the process entry is `src/main.ts`.

export { OperatorServer, type OperatorServerOptions } from './server.js';
export type { OperatorControl } from './OperatorControl.js';
export { loadOperatorConfig, DEFAULT_OPERATOR_PORT, type OperatorConfig } from './config.js';

// errors
export { OperatorConfigError } from './errors/OperatorConfigError.js';
export { OperatorHttpError } from './errors/OperatorHttpError.js';
export { OperatorServerStartError } from './errors/OperatorServerStartError.js';
