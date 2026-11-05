import { memo, useCallback, useEffect, useState } from "react";
import { isTauriRuntime } from "../../lib/tauri-env";
import {
  disableKbAssistant,
  enableKbAssistant,
  fetchKbAssistantStatus,
  hotReloadKbAssistantAfterToggle,
  KB_ASSISTANT_DEFAULT_BASE_URL,
  probeKbAssistantHealth,
  saveKbAssistantConfig,
  type KbAssistantStatus,
} from "../../lib/yuntuai/kb-assistant-bridge";
import { useUiStore } from "../../stores/uiStore";

export const KbAssistantSettingsPanel = memo(function KbAssistantSettingsPanel() {
  const showToast = useUiStore((s) => s.showToast);

  const [status, setStatus] = useState<KbAssistantStatus | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [probing, setProbing] = useState(false);

  const reload = useCallback(async (probeHealth = false) => {
    const next = await fetchKbAssistantStatus(probeHealth);
    if (next) {
      setStatus(next);
      setBaseUrl(next.baseUrl || "");
    }
    return next;
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) {
      setLoading(false);
      return;
    }
    void reload().finally(() => setLoading(false));
  }, [reload]);

  const onProbe = useCallback(async () => {
    if (!isTauriRuntime() || probing) return;
    setProbing(true);
    try {
      const next = await probeKbAssistantHealth(baseUrl.trim());
      if (next) {
        setStatus(next);
        showToast(next.healthOk ? "知识库服务连接正常" : (next.healthMessage ?? "连接失败"), next.healthOk ? "success" : "error");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setProbing(false);
    }
  }, [baseUrl, probing, showToast]);

  const onToggle = useCallback(async () => {
    if (!isTauriRuntime() || busy || !status) return;
    setBusy(true);
    try {
      if (status.enabled) {
        const next = await disableKbAssistant();
        if (next) setStatus(next);
        await hotReloadKbAssistantAfterToggle(false);
        showToast("已关闭知识库助手", "success");
      } else {
        const url = baseUrl.trim();
        if (!url) {
          showToast("请先填写知识库服务地址", "error");
          return;
        }
        const next = await enableKbAssistant(url);
        if (next) setStatus(next);
        await hotReloadKbAssistantAfterToggle(true);
        showToast("知识库助手已启用，可在 Agent 指挥中心切换到「知识库助手」", "success");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }, [baseUrl, busy, showToast, status]);

  const onSaveConfig = useCallback(async () => {
    if (!isTauriRuntime() || busy) return;
    setBusy(true);
    try {
      const next = await saveKbAssistantConfig(baseUrl.trim());
      if (next) setStatus(next);
      showToast("知识库服务地址已保存", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }, [baseUrl, busy, showToast]);

  if (!isTauriRuntime()) return null;

  const enabled = status?.enabled ?? false;

  return (
    <div
      id="kb-assistant-settings"
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4"
    >
      <div className="font-medium text-[var(--text-primary)]">知识库助手</div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
        对接局域网 KRET-RAG 知识库，专用 Agent「知识库助手」会先检索已入库文档再作答。
        启用前需配置可访问的知识库服务地址。
      </p>

      <label className="mt-4 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand-color)]"
          checked={enabled}
          disabled={loading || busy}
          onChange={() => void onToggle()}
        />
        <span className="text-sm text-[var(--text-primary)]">
          启用知识库助手
          {loading ? "（加载中…）" : enabled ? "（已启用）" : ""}
        </span>
      </label>

      <div className="mt-4 space-y-2">
        <label className="block text-xs font-medium text-[var(--text-secondary)]" htmlFor="kb-assistant-base-url">
          知识库服务地址
        </label>
        <input
          id="kb-assistant-base-url"
          type="url"
          value={baseUrl}
          disabled={busy}
          placeholder={KB_ASSISTANT_DEFAULT_BASE_URL}
          onChange={(e) => setBaseUrl(e.target.value)}
          className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--brand-color)]"
        />
        <p className="text-[11px] text-[var(--text-tertiary)]">
          写入本机服务 `.env` 的 `KRET_RAG_BASE_URL`。默认示例为 103 局域网地址，请按实际环境修改。
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="yt-btn-svc" disabled={busy || probing} onClick={() => void onProbe()}>
          {probing ? "测试中…" : "测试连接"}
        </button>
        <button type="button" className="yt-btn-svc" disabled={busy} onClick={() => void onSaveConfig()}>
          保存地址
        </button>
      </div>

      {status?.healthMessage && (
        <p
          className={`mt-2 text-xs ${status.healthOk ? "text-emerald-300" : "text-[var(--color-error)]"}`}
        >
          连接状态：{status.healthMessage}
        </p>
      )}

      {status && (
        <ul className="mt-3 space-y-0.5 text-[11px] text-[var(--text-tertiary)]">
          <li>技能文件：{status.skillInstalled ? "已安装" : "未安装（启用时自动同步）"}</li>
          <li>专用 Agent：{status.agentPresent ? "已注册 kb-assistant" : "未注册"}</li>
        </ul>
      )}

      {enabled && (
        <p className="mt-3 text-xs text-[var(--text-secondary)]">
          启用后请在顶部 Agent 列表切换到「知识库助手」。上传文档请在知识库 Web 管理页完成，本功能仅负责检索与问答。
        </p>
      )}
    </div>
  );
});
