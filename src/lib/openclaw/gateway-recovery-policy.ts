/** 全链路统一的网关恢复 / supervisor IPC 超时（毫秒）。 */
export const GATEWAY_RECOVERY_TIMEOUT_MS = 45_000;

/** prepareGatewayForConnect 外层超时，需覆盖 ensure + repair 预算。 */
export const GATEWAY_PREPARE_MAX_MS = 30_000;
