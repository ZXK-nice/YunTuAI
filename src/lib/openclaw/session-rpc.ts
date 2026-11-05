/** Best-effort parsing of Gateway session RPC payloads (shape varies by version). */

export type SessionsSendAttachment = {
  fileName?: string;
  mimeType: string;
  content: string;
};

export function extractSessionKey(res: unknown): string | undefined {
  if (!res || typeof res !== "object") return undefined;
  const r = res as Record<string, unknown>;
  if (typeof r.sessionKey === "string" && r.sessionKey.trim()) return r.sessionKey.trim();
  if (typeof r.key === "string" && r.key.trim()) return r.key.trim();
  const s = r.session;
  if (s && typeof s === "object") {
    const sk = (s as Record<string, unknown>).sessionKey ?? (s as Record<string, unknown>).key;
    if (typeof sk === "string" && sk.trim()) return sk.trim();
  }
  return undefined;
}

export type YunTuAiSendMetadata = {
  sendId?: string;
  taskPlanId?: string;
  officeAttachmentKinds?: string[];
  officeContractVersion?: string;
  officeSkillIds?: string[];
  officeCapabilityMetadata?: Record<string, unknown>;
  ocrContentHash?: string;
  preExtractSummary?: string;
};

/** 字段名为 `key`，不是 `sessionKey`（与上游网关 schema 一致） */
export function buildSessionsSendParams(
  sessionKey: string,
  message: string,
  opts?: {
    timeoutMs?: number;
    idempotencyKey?: string;
    attachments?: SessionsSendAttachment[];
    /** 仅本机模式：随消息附带工具 denylist 元数据（网关可识别时生效） */
    localOnlyMode?: boolean;
    toolDenylist?: readonly string[];
    yuntuai?: YunTuAiSendMetadata;
  },
): Record<string, unknown> {
  const p: Record<string, unknown> = {
    key: sessionKey,
    message,
  };
  if (opts?.timeoutMs !== undefined) p.timeoutMs = opts.timeoutMs;
  if (opts?.idempotencyKey) p.idempotencyKey = opts.idempotencyKey;
  if (opts?.attachments?.length) p.attachments = opts.attachments;
  const metadata: Record<string, unknown> = {};
  if (opts?.localOnlyMode) {
    metadata.yuntuaiLocalOnly = true;
    metadata.toolDenylist = opts.toolDenylist ?? [];
  }
  if (opts?.yuntuai) {
    if (opts.yuntuai.sendId) metadata.yuntuaiSendId = opts.yuntuai.sendId;
    if (opts.yuntuai.taskPlanId) metadata.yuntuaiTaskPlanId = opts.yuntuai.taskPlanId;
    if (opts.yuntuai.officeAttachmentKinds?.length) {
      metadata.yuntuaiOfficeKinds = opts.yuntuai.officeAttachmentKinds;
    }
    if (opts.yuntuai.officeContractVersion) {
      metadata.yuntuaiOfficeContractVersion = opts.yuntuai.officeContractVersion;
    }
    if (opts.yuntuai.officeSkillIds?.length) {
      metadata.yuntuaiOfficeSkills = opts.yuntuai.officeSkillIds;
    }
    if (opts.yuntuai.officeCapabilityMetadata) {
      Object.assign(metadata, opts.yuntuai.officeCapabilityMetadata);
    }
    if (opts.yuntuai.ocrContentHash) metadata.yuntuaiOcrHash = opts.yuntuai.ocrContentHash;
    if (opts.yuntuai.preExtractSummary) {
      metadata.yuntuaiPreExtract = opts.yuntuai.preExtractSummary.slice(0, 2_000);
    }
  }
  if (Object.keys(metadata).length > 0) p.metadata = metadata;
  return p;
}

/** `chat.send` 使用 `sessionKey`（非 `sessions.send` 的 `key`）。 */
export function buildChatSendParams(
  sessionKey: string,
  message: string,
  opts?: Parameters<typeof buildSessionsSendParams>[2],
): Record<string, unknown> {
  const sessionsParams = buildSessionsSendParams(sessionKey, message, opts);
  const key = sessionsParams.key;
  const sk = typeof key === "string" && key.trim() ? key.trim() : sessionKey.trim();
  const { key: _drop, ...rest } = sessionsParams;
  return { ...rest, sessionKey: sk };
}

/** 将 `sessions.send` 形参转为指定网关方法所需字段。
 *  根级 metadata 会被网关 schema 拒绝，故在 adapt 时剥离；仅本机工具限制改由
 *  `patchSessionLocalOnlyForSend` → `sessions.patch` 在发送前写入。 */
export function adaptSendParamsForGatewayMethod(
  method: "chat.send" | "sessions.send",
  sendParams: Record<string, unknown>,
): Record<string, unknown> {
  // 当前 OpenClaw 网关 schema 不接受根级 metadata（sessions.send / chat.send 均会 INVALID_REQUEST）
  const { metadata: _meta, ...withoutMeta } = sendParams;
  if (method === "sessions.send") return withoutMeta;
  const key = withoutMeta.key;
  if (typeof key === "string" && key.trim()) {
    const { key: _drop, ...rest } = withoutMeta;
    return { ...rest, sessionKey: key.trim() };
  }
  return withoutMeta;
}

/** `sessions.*` 写操作 RPC 的会话标识字段为 `key`（非 `sessionKey`）。 */
export function buildSessionRpcKeyParams(sessionKey: string): Record<string, unknown> {
  return { key: sessionKey.trim() };
}

/**
 * 解析为网关内部使用的规范 session key（与 `chat` 事件里的 `sessionKey` 对齐）。
 * `sessions.resolve` → `{ ok: true, key }`
 */
export async function resolveCanonicalSessionKey(
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  sessionKey: string,
): Promise<string | undefined> {
  const key = sessionKey.trim();
  if (!key) return undefined;
  try {
    const raw = await request("sessions.resolve", { key });
    if (!raw || typeof raw !== "object") return undefined;
    const r = raw as Record<string, unknown>;
    if (r.ok === true && typeof r.key === "string" && r.key.trim()) return r.key.trim();
  } catch {
    /* ignore */
  }
  return undefined;
}
