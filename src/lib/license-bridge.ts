import { invoke } from "@tauri-apps/api/core";
import { invokeAuthed } from "./tauri-invoke";

export type LicenseStatus = {
  licensed: boolean;
  fingerprint: string;
  message: string;
  expiresAt?: string | null;
  expired?: boolean;
  renewSoon?: boolean;
  daysRemaining?: number | null;
};

export async function fetchLicenseStatus(): Promise<LicenseStatus | null> {
  try {
    return await invoke<LicenseStatus>("check_license");
  } catch {
    return null;
  }
}

export async function activateLicense(content: string): Promise<LicenseStatus | null> {
  return invoke<LicenseStatus>("activate_license", { content: normalizeLicensePaste(content) });
}

export async function installLicenseAsOwner(content: string): Promise<LicenseStatus | null> {
  return invokeAuthed<LicenseStatus>("install_license", { content: normalizeLicensePaste(content) });
}

export async function generateLicenseContent(
  fingerprint: string,
  note?: string,
  validDays = 30,
): Promise<string | null> {
  const json = await invokeAuthed<string>("generate_license_content", {
    fingerprint: fingerprint.trim(),
    note: note?.trim() ?? "",
    validDays: Math.max(1, Math.floor(validDays)),
  });
  return json ?? null;
}

const FINGERPRINT_RE = /^[0-9a-f]{64}$/i;

export function isValidLicenseFingerprint(value: string): boolean {
  return FINGERPRINT_RE.test(value.trim());
}

export function formatLicenseExpiryLabel(expiresAt: string | null | undefined): string {
  if (!expiresAt?.trim()) return "";
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return expiresAt;
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 从粘贴板或文件内容中提取 license.dat JSON（去掉 markdown 代码块、BOM、首尾空白）。 */
export function normalizeLicensePaste(raw: string): string {
  let text = raw.replace(/^\uFEFF/, "").trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fenced?.[1]) {
    text = fenced[1].trim();
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    text = text.slice(start, end + 1);
  }
  return text.trim();
}

export function humanizeLicenseActivateError(message: string): string {
  const m = message.trim();
  if (m.includes("签名无效") || m.includes("密钥不匹配")) {
    return `${m}\n\n提示：请确认授权 JSON 由与本安装包相同密钥签发（构建时的 activation.secret），且粘贴了完整 JSON。`;
  }
  if (m.includes("设备不匹配") || m.includes("指纹")) {
    return `${m}\n\n提示：授权 JSON 中的 fingerprint 必须与上方「机器指纹」完全一致（可点「复制指纹」后让管理员重新签发）。`;
  }
  if (m.includes("内容无效") || m.includes("JSON")) {
    return `${m}\n\n提示：请只粘贴 { "fingerprint": "...", "signature": "..." } 整段 JSON，不要带文件名或多余说明文字。`;
  }
  return m;
}

export function isConnectSlowHint(message: string | null | undefined): boolean {
  if (!message?.trim()) return false;
  return /较慢|已解锁|界面已解锁/.test(message);
}
