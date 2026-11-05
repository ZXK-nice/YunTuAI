/**
 * YunTu AOS（social-auto-upload）本机 API 客户端。
 * 需带云图官方客户端标识，否则 AOS 返回 403。
 */
import { APP_VERSION } from "../app-version";

const DEFAULT_BASE = "http://127.0.0.1:5409";
const DEFAULT_TOKEN = "yuntu-local-dev-token";
const CLIENT_ID = "yuntu-aos-desktop";

const TOKEN_KEY = "yuntu:aos-api-token";
const BASE_KEY = "yuntu:aos-api-base";

export type AosJobItem = {
  id?: string;
  status?: string;
  platform?: string;
  account?: string;
  title?: string;
  platformUrl?: string;
  failureCode?: string | null;
  message?: string | null;
};

export type AosJobSummary = {
  jobId: string;
  title?: string;
  status?: string;
  source?: string;
  totalItems?: number;
  completedItems?: number;
  failedItems?: number;
  terminal?: boolean;
  items?: AosJobItem[];
};

export function getAosApiBase(): string {
  try {
    const raw = localStorage.getItem(BASE_KEY)?.trim();
    return raw || DEFAULT_BASE;
  } catch {
    return DEFAULT_BASE;
  }
}

export function getAosApiToken(): string {
  try {
    const raw = localStorage.getItem(TOKEN_KEY)?.trim();
    return raw || DEFAULT_TOKEN;
  } catch {
    return DEFAULT_TOKEN;
  }
}

function aosHeaders(): HeadersInit {
  return {
    Accept: "application/json",
    "X-YunTu-Client": CLIENT_ID,
    "X-YunTu-Token": getAosApiToken(),
    "User-Agent": `YunTuAI/${APP_VERSION} (yuntu-aos-desktop)`,
  };
}

const TERMINAL = new Set(["completed", "failed", "partial_failed"]);

export function isAosJobTerminal(status: string | undefined): boolean {
  return TERMINAL.has((status ?? "").trim().toLowerCase());
}

const TYPE_LABEL: Record<number, string> = {
  1: "小红书",
  2: "视频号",
  3: "抖音",
  4: "快手",
  5: "B站",
};

function normalizeAosJob(jobId: string, d: Record<string, unknown>): AosJobSummary {
  const rawItems = Array.isArray(d.items) ? (d.items as Record<string, unknown>[]) : [];
  const items: AosJobItem[] = rawItems.map((it) => {
    const pt = Number(it.platform_type ?? it.task_platform_type ?? 0);
    return {
      id: it.id != null ? String(it.id) : undefined,
      status: it.status != null ? String(it.status) : undefined,
      platform: TYPE_LABEL[pt] ?? (pt ? String(pt) : undefined),
      account: it.account_name != null ? String(it.account_name) : undefined,
      title: it.item_title != null ? String(it.item_title) : undefined,
      platformUrl: it.platform_url != null ? String(it.platform_url) : undefined,
      failureCode: it.failure_code != null ? String(it.failure_code) : null,
      message: it.message != null ? String(it.message) : null,
    };
  });
  const status = d.status != null ? String(d.status) : undefined;
  return {
    jobId: String(d.id ?? d.jobId ?? jobId),
    title: typeof d.title === "string" ? d.title : undefined,
    status,
    source: typeof d.source === "string" ? d.source : undefined,
    totalItems: typeof d.total_items === "number" ? d.total_items : undefined,
    completedItems: typeof d.completed_items === "number" ? d.completed_items : undefined,
    failedItems: typeof d.failed_items === "number" ? d.failed_items : undefined,
    terminal: isAosJobTerminal(status),
    items,
  };
}

export async function fetchAosJob(jobId: string): Promise<AosJobSummary | null> {
  const base = getAosApiBase().replace(/\/$/, "");
  const url = `${base}/api/jobs/${encodeURIComponent(jobId)}`;
  try {
    const res = await fetch(url, { headers: aosHeaders(), cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { code?: number; data?: Record<string, unknown> };
    if (json.code !== 200 || !json.data) return null;
    return normalizeAosJob(jobId, json.data);
  } catch {
    return null;
  }
}

export async function fetchAosHealth(): Promise<boolean> {
  const base = getAosApiBase().replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/health`, { cache: "no-store" });
    if (!res.ok) return false;
    const json = (await res.json()) as { worker?: { alive?: boolean } };
    return Boolean(json.worker?.alive ?? true);
  } catch {
    return false;
  }
}

export function formatAosJobReport(job: AosJobSummary): string {
  const lines = [
    "【AOS 任务终态汇报】",
    "",
    `- job_id：\`${job.jobId}\``,
    `- 状态：${job.status ?? "unknown"}`,
  ];
  if (job.title) lines.push(`- 标题：${job.title}`);
  if (job.totalItems != null) {
    lines.push(
      `- 进度：${job.completedItems ?? 0}/${job.totalItems} 成功，失败 ${job.failedItems ?? 0}`,
    );
  }
  lines.push("", "| 平台 | 账号 | 视频/标题 | 状态 | 失败码 |", "| --- | --- | --- | --- | --- |");
  for (const item of job.items ?? []) {
    lines.push(
      `| ${item.platform ?? "-"} | ${item.account ?? "-"} | ${(item.title ?? "-").slice(0, 24)} | ${item.status ?? "-"} | ${item.failureCode ?? "-"} |`,
    );
  }
  lines.push("", "可在 AOS 控制台或 output 目录查看截图与日志；有疑问请直接追问。");
  return lines.join("\n");
}
