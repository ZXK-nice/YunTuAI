/**
 * Gateway WebSocket `connect` 帧。第三方桌面 UI（如 clawport-ui）常改用本机
 * `openclaw gateway call …`，避免浏览器侧设备签名；见 clawport `lib/anthropic.ts`、`lib/gateway-health.ts`。
 */
import { newRequestId } from "./ids";
import type { GatewayReq } from "./types";
import { APP_VERSION } from "../app-version";

/** `openclaw-control-ui` 在网关内视为 Operator UI（`isOperatorUiClient`），无设备密钥时与 `allowInsecureAuth` 配合可保留 scopes */
const CLIENT_ID_CONTROL_UI = "openclaw-control-ui";
const CLIENT_MODE_WEBCHAT = "webchat";

export type ConnectParams = {
  token?: string;
};

export function buildConnectRequest(params: ConnectParams): GatewayReq {
  const id = newRequestId();
  const token = params.token?.trim() ?? "";

  const platform =
    typeof navigator !== "undefined" && navigator.platform?.trim()
      ? navigator.platform
      : "web";

  const body: Record<string, unknown> = {
    minProtocol: 3,
    maxProtocol: 4,
    /**
     * `client.id` / `client.mode` 必须是网关 schema 中的字面量（见 OpenClaw `GATEWAY_CLIENT_IDS` / `GATEWAY_CLIENT_MODES`）。
     * `role: "operator"` 与 **client.mode** 无关；mode 不能用 `"operator"`（合法值为 webchat、cli、ui 等）。
     *
     * 勿用 `webchat-ui`：网关对无设备身份的 token 连接会清空自声明 scopes（`shouldClearUnboundScopes…`），导致
     * `missing scope: operator.admin` / `operator.read`。`openclaw-control-ui` 在回环 + 配置
     * `gateway.controlUi.allowInsecureAuth: true` 时可保留 scopes（本机 HTTP 开发，见设置页说明）。
     */
    client: {
      id: CLIENT_ID_CONTROL_UI,
      version: APP_VERSION,
      platform,
      mode: CLIENT_MODE_WEBCHAT,
    },
    role: "operator",
    /** 与网关 `method-scopes` / CLI 默认一致；`connect` 本身需要 `operator.admin`，`status` 等需要 `operator.read` */
    scopes: [
      "operator.admin",
      "operator.approvals",
      "operator.pairing",
      "operator.read",
      "operator.write",
    ],
    caps: ["tool-events"],
    commands: [],
    permissions: {},
    auth: { token },
    locale: typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US",
    userAgent: `YunTuAI/${APP_VERSION}`,
  };

  /** 勿传半截 `device`：2026.4+ schema 要求 publicKey / signature / signedAt / nonce 齐全，否则网关直接 1008「invalid connect params」。设备证明需 Web Crypto 或 Tauri 侧实现后再接 connect.challenge。 */

  return {
    type: "req",
    id,
    method: "connect",
    params: body,
  };
}
