import { useCallback, useEffect, useMemo, useState } from "react";
import { chatOpenFile } from "../../lib/chat/chat-files-bridge";
import { PRODUCT_NAME } from "../../lib/product-brand";
import { useImageFilePreview, clearImagePreviewCache } from "../../hooks/useImageFilePreview";
import { useInView } from "../../hooks/useInView";
import {
  createGeneratedImage,
  deleteGeneratedImage,
  exportGeneratedImage,
  fetchImageGenConfig,
  IMAGE_GEN_HISTORY_CAP,
  IMAGE_GEN_MAX_REFERENCES,
  IMAGE_GEN_PROVIDERS,
  IMAGE_GEN_SIZES,
  listGeneratedImages,
  pickReferenceImages,
  providerLabel,
  revealImageStudioFolder,
  saveImageGenConfig,
  testImageGenConnection,
  useChatApiKeyForImageGen,
  suggestProviderForApiKey,
  type GeneratedImageItem,
  type ImageGenConfig,
  type ImageGenMode,
  type ImageGenProvider,
} from "../../lib/image-gen/image-gen-bridge";
import { revealPathInOs } from "../../lib/openclaw/os-open";
import { isTauriRuntime } from "../../lib/tauri-env";
import { useUiStore } from "../../stores/uiStore";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import {
  checkerBg,
  fieldClass,
  IconDownload,
  IconExternal,
  IconTrash,
  ImageStudioCard,
  ImageStudioHero,
  ImageStudioShell,
  ModeSegment,
  panelGlass,
  PromptSuggestionChips,
  ReferenceDropzone,
  SizeChipGroup,
  studioStageClass,
  textareaClass,
  ThumbSkeleton,
  ToolbarButton,
} from "./image-studio-ui";

const PROMPT_MAX = 4000;

const TEXT_SUGGESTIONS = [
  { label: "科技海报", text: "简约科技风产品海报，蓝白配色，干净留白，中央产品主体" },
  { label: "产品摄影", text: "专业产品摄影，柔光棚拍，浅景深，质感细腻，商业广告风格" },
  { label: "电影光影", text: "电影大片质感，强对比光影，广角透视，戏剧性氛围" },
  { label: "插画风格", text: "扁平矢量插画，明亮配色，干净线条，适合应用封面" },
] as const;

const IMAGE_SUGGESTIONS = [
  { label: "换背景", text: "保持主体不变，将背景替换为干净科技展厅，增强光影质感" },
  { label: "风格化", text: "将画面重绘为吉卜力动画风格，保留构图与主体特征" },
  { label: "增强细节", text: "提升画面清晰度与材质细节，保持原有内容与色调" },
  { label: "海报化", text: "改为商业海报排版，增加标题留白区域，高级质感" },
] as const;

function providerMeta(id: string) {
  return IMAGE_GEN_PROVIDERS.find((p) => p.id === id) ?? IMAGE_GEN_PROVIDERS[0]!;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ghostBtnClass(active?: boolean) {
  return [
    "yt-transition rounded-full border px-4 py-1.5 text-xs font-medium",
    active
      ? "border-[var(--brand-color)] bg-[var(--brand-tint-8)] text-[var(--brand-color)]"
      : "border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--brand-color)] hover:text-[var(--text-primary)]",
  ].join(" ");
}

function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

function RefThumb({
  path,
  disabled,
  onRemove,
}: {
  path: string;
  disabled?: boolean;
  onRemove: () => void;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const { src, failed } = useImageFilePreview(path, inView);
  return (
    <div
      ref={ref}
      className="group relative h-[4.75rem] w-[4.75rem] shrink-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)]"
    >
      {src ? (
        <img src={src} alt={basename(path)} className="h-full w-full object-cover" />
      ) : failed ? (
        <div className="flex h-full items-center justify-center text-[9px] text-rose-300">失败</div>
      ) : (
        <ThumbSkeleton />
      )}
      <button
        type="button"
        disabled={disabled}
        aria-label="移除参考图"
        onClick={onRemove}
        className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition group-hover:opacity-100 disabled:opacity-40"
      >
        ×
      </button>
    </div>
  );
}

function ImageThumb({
  item,
  selected,
  onSelect,
  compact,
}: {
  item: GeneratedImageItem;
  selected: boolean;
  onSelect: () => void;
  compact?: boolean;
}) {
  const { ref, inView } = useInView();
  const { src, failed } = useImageFilePreview(item.path, inView);
  const isImg2Img = item.mode === "image" || (item.referenceCount ?? 0) > 0;
  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      className={[
        "group relative shrink-0 snap-start overflow-hidden rounded-[var(--radius-md)] border text-left transition-all",
        compact ? "w-[5.25rem]" : "w-full",
        selected
          ? "border-[var(--brand-color)] ring-2 ring-[var(--brand-color)]/25"
          : "border-[var(--border-subtle)] hover:border-[var(--brand-color)]/45",
      ].join(" ")}
    >
      <div className="relative aspect-square w-full bg-[var(--bg-base)]">
        {src ? (
          <img src={src} alt={item.prompt || item.name} className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
        ) : failed ? (
          <div className="flex h-full items-center justify-center text-[9px] text-[var(--text-muted)]">失败</div>
        ) : (
          <ThumbSkeleton />
        )}
        {isImg2Img ? (
          <span className="absolute left-1 top-1 rounded bg-black/50 px-1 py-0.5 text-[8px] text-white">图生</span>
        ) : null}
      </div>
      {!compact ? (
        <div className="border-t border-[var(--border-subtle)] px-2 py-1.5">
          <p className="line-clamp-2 text-[10px] leading-snug text-[var(--text-secondary)]">{item.prompt || item.name}</p>
          <p className="mt-0.5 text-[9px] tabular-nums text-[var(--text-muted)]">{formatTime(item.createdAtMs)}</p>
        </div>
      ) : null}
    </button>
  );
}

export function ImageStudioPanel() {
  const showToast = useUiStore((s) => s.showToast);
  const queueChatContext = useUiStore((s) => s.queueChatContext);
  const requestNavToComposeChat = useUiStore((s) => s.requestNavToComposeChat);
  const [config, setConfig] = useState<ImageGenConfig | null>(null);
  const [items, setItems] = useState<GeneratedImageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [statusLine, setStatusLine] = useState("");

  const [showSetup, setShowSetup] = useState(false);
  const [provider, setProvider] = useState<ImageGenProvider>("volcengine");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(providerMeta("volcengine").defaultBaseUrl);
  const [model, setModel] = useState(providerMeta("volcengine").defaultModel);
  const [size, setSize] = useState<string>("2K");

  const [genMode, setGenMode] = useState<ImageGenMode>("text");
  const [referencePaths, setReferencePaths] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [selected, setSelected] = useState<GeneratedImageItem | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const { src: selectedSrc, failed: selectedPreviewFailed } = useImageFilePreview(selected?.path);

  const suggestions = genMode === "image" ? IMAGE_SUGGESTIONS : TEXT_SUGGESTIONS;

  const refresh = useCallback(async () => {
    if (!isTauriRuntime()) {
      setLoading(false);
      return;
    }
    const [cfg, list] = await Promise.all([fetchImageGenConfig(), listGeneratedImages()]);
    if (cfg) {
      setConfig(cfg);
      const p = (cfg.provider as ImageGenProvider) || "volcengine";
      setProvider(p);
      setModel(cfg.model);
      setBaseUrl(cfg.baseUrl);
      setSize(cfg.size || "2K");
      setShowSetup(!cfg.configured);
    }
    if (list) setItems(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selected && items.length > 0) {
      setSelected(items[0]!);
      setEditPrompt(items[0]!.prompt);
    }
  }, [items, selected]);

  const onProviderChange = useCallback((next: ImageGenProvider) => {
    setProvider(next);
    const meta = providerMeta(next);
    setModel(meta.defaultModel);
    setBaseUrl(meta.defaultBaseUrl);
  }, []);

  useEffect(() => {
    const suggested = suggestProviderForApiKey(apiKey);
    if (suggested && suggested !== provider) onProviderChange(suggested);
  }, [apiKey, onProviderChange, provider]);

  const addReferencePaths = useCallback(
    (incoming: string[]) => {
      if (!incoming.length) return;
      setReferencePaths((prev) => {
        const merged = [...prev];
        for (const p of incoming) {
          if (merged.length >= IMAGE_GEN_MAX_REFERENCES) break;
          if (!merged.includes(p)) merged.push(p);
        }
        return merged;
      });
      setGenMode("image");
    },
    [],
  );

  const onPickReferences = useCallback(async () => {
    const picked = await pickReferenceImages();
    if (picked.length) addReferencePaths(picked);
  }, [addReferencePaths]);

  const onUseCurrentAsReference = useCallback(() => {
    if (!selected?.path) return;
    addReferencePaths([selected.path]);
    showToast("已将当前预览加入参考图", "info");
  }, [addReferencePaths, selected?.path, showToast]);

  const onSendToChat = useCallback(() => {
    if (!selected) return;
    queueChatContext(
      `请基于这张作图结果继续协助我。\n\n原始提示词：${selected.prompt}`,
      [
        {
          kind: "image",
          path: selected.path,
          prompt: selected.prompt,
          model: selected.model,
          size: size,
        },
      ],
    );
    requestNavToComposeChat();
    showToast("已将作图卡片填入对话，请确认后发送", "success");
  }, [queueChatContext, requestNavToComposeChat, selected, showToast, size]);

  const selectItem = useCallback((item: GeneratedImageItem) => {
    setSelected(item);
    setEditPrompt(item.prompt);
    if (item.referencePaths?.length) {
      setGenMode("image");
      setReferencePaths(item.referencePaths);
    }
  }, []);

  const onUseChatApiKey = useCallback(async () => {
    setError("");
    setBusy(true);
    try {
      const saved = await useChatApiKeyForImageGen();
      setConfig(saved);
      setApiKey("");
      setShowSetup(false);
      showToast("已使用对话 API Key 作为作图 Key", "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [showToast]);

  const onSaveConfig = useCallback(async () => {
    setError("");
    setStatusLine("");
    setBusy(true);
    try {
      const saved = await saveImageGenConfig({
        provider,
        apiKey: apiKey.trim() || undefined,
        baseUrl,
        model,
        size,
      });
      if (!saved) throw new Error("保存失败，请确认已登录且本机数据目录可写");
      setConfig(saved);
      setApiKey("");
      setShowSetup(false);
      showToast("作图 API 已保存", "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [apiKey, baseUrl, model, provider, showToast, size]);

  const onTestConnection = useCallback(async () => {
    setError("");
    setStatusLine("");
    if (!apiKey.trim() && !config?.configured) {
      setError("请先填写 API Key");
      return;
    }
    setTesting(true);
    try {
      if (apiKey.trim()) {
        await saveImageGenConfig({ provider, apiKey: apiKey.trim(), baseUrl, model, size });
        const cfg = await fetchImageGenConfig();
        if (cfg) setConfig(cfg);
      }
      const msg = await testImageGenConnection();
      if (!msg) throw new Error("连接测试失败");
      setStatusLine(msg);
      showToast(msg, "success");
      if (apiKey.trim()) {
        setApiKey("");
        const cfg = await fetchImageGenConfig();
        if (cfg) setConfig(cfg);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }, [apiKey, baseUrl, config?.configured, model, provider, showToast, size]);

  const onGenerate = useCallback(
    async (text: string, refs?: string[]) => {
      const p = text.trim();
      if (!p) {
        setError("请输入提示词");
        return;
      }
      if (p.length > PROMPT_MAX) {
        setError(`提示词过长（最多 ${PROMPT_MAX} 字）`);
        return;
      }
      if (!config?.configured) {
        setShowSetup(true);
        setError("请先在「API 接入」中配置并保存 Seedream API Key");
        return;
      }
      const useRefs = genMode === "image" ? (refs ?? referencePaths) : [];
      if (genMode === "image" && useRefs.length === 0) {
        setError("图生图模式请至少添加一张参考图");
        return;
      }
      setError("");
      setStatusLine(genMode === "image" ? "图生图生成中，通常需要 1～2 分钟…" : "文生图生成中，通常需要 1～2 分钟…");
      setBusy(true);
      try {
        const item = await createGeneratedImage(p, size, genMode === "image" ? useRefs : undefined);
        setItems((prev) => [item, ...prev].slice(0, IMAGE_GEN_HISTORY_CAP));
        selectItem(item);
        setPrompt("");
        setStatusLine(`已生成 · ${formatBytes(item.size)}${item.mode === "image" ? " · 图生图" : ""}`);
        showToast("图片已生成并保存到本机", "success");
      } catch (e) {
        setStatusLine("");
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [config?.configured, genMode, referencePaths, selectItem, showToast, size],
  );

  const onDelete = useCallback(
    (id: string) => {
      setPendingDeleteId(id);
    },
    [],
  );

  const confirmDelete = useCallback(
    async () => {
      const id = pendingDeleteId;
      if (!id) return;
      setPendingDeleteId(null);
      setBusy(true);
      try {
        const deleted = items.find((x) => x.id === id);
        await deleteGeneratedImage(id);
        if (deleted?.path) clearImagePreviewCache(deleted.path);
        const next = items.filter((x) => x.id !== id);
        setItems(next);
        if (selected?.id === id) {
          const first = next[0] ?? null;
          setSelected(first);
          setEditPrompt(first?.prompt ?? "");
        }
        showToast("已删除", "info");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [items, pendingDeleteId, selected?.id, showToast],
  );

  const onDownload = useCallback(
    async (item: GeneratedImageItem) => {
      setDownloading(true);
      setError("");
      try {
        const dest = await exportGeneratedImage(item.path);
        if (dest) showToast(`已保存到 ${dest}`, "success");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setDownloading(false);
      }
    },
    [showToast],
  );

  const onPromptKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>, text: string) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (!busy) void onGenerate(text);
      }
    },
    [busy, onGenerate],
  );

  const appendSuggestion = useCallback((text: string) => {
    setPrompt((prev) => (prev.trim() ? `${prev.trim()}，${text}` : text));
  }, []);

  const configuredSummary = useMemo(() => {
    if (!config?.configured) return null;
    return `${providerLabel(config.provider)} · ${config.model} · ${config.size}`;
  }, [config]);

  if (!isTauriRuntime()) {
    return (
      <div className={`${panelGlass} p-6 text-sm text-[var(--text-secondary)]`}>
        作图需在 {PRODUCT_NAME} 桌面客户端中使用。
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[16rem] flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--brand-color)] border-t-transparent" />
        <p className="text-sm text-[var(--text-tertiary)]">正在加载作图…</p>
      </div>
    );
  }

  return (
    <ImageStudioShell>
      <ImageStudioHero
        configured={!!config?.configured}
        worksCount={items.length}
        summary={configuredSummary}
        actions={
          <>
            <button type="button" className={ghostBtnClass(showSetup)} onClick={() => setShowSetup((v) => !v)}>
              {showSetup ? "收起接入" : "API 接入"}
            </button>
            <button
              type="button"
              className={ghostBtnClass()}
              onClick={() => {
                void revealImageStudioFolder().then((p) => {
                  if (p) void revealPathInOs(p);
                });
              }}
            >
              打开文件夹
            </button>
          </>
        }
      />

      {showSetup ? (
        <div className={`${panelGlass} border-l-2 border-l-[var(--brand-color)] p-5`}>
          <h3 className="text-sm font-medium text-[var(--text-primary)]">API 接入</h3>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            <span className="font-mono">ark-</span> → 火山方舟 · <span className="font-mono">apikey-</span> → 万码云
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block text-xs text-[var(--text-secondary)]">
              服务商
              <select className={fieldClass} value={provider} onChange={(e) => onProviderChange(e.target.value as ImageGenProvider)}>
                {IMAGE_GEN_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[10px] text-[var(--text-muted)]">{providerMeta(provider).hint}</span>
            </label>
            <label className="block text-xs text-[var(--text-secondary)]">
              API Key
              <input
                type="password"
                className={fieldClass}
                placeholder={config?.apiKeyHint ? `已配置 ${config.apiKeyHint}` : "粘贴 API Key"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="block text-xs text-[var(--text-secondary)] md:col-span-2">
              接口地址
              <input className={`${fieldClass} font-mono text-xs`} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            </label>
            <label className="block text-xs text-[var(--text-secondary)]">
              模型 ID
              <input className={`${fieldClass} font-mono`} value={model} onChange={(e) => setModel(e.target.value)} />
            </label>
            <label className="block text-xs text-[var(--text-secondary)]">
              默认尺寸
              <div className="mt-1.5">
                <SizeChipGroup value={size} options={IMAGE_GEN_SIZES} onChange={setSize} />
              </div>
            </label>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" disabled={busy || testing} onClick={() => void onUseChatApiKey()} className={ghostBtnClass()}>
              使用对话 Key
            </button>
            <button type="button" disabled={busy || testing} onClick={() => void onTestConnection()} className={ghostBtnClass()}>
              {testing ? "测试中…" : "测试连接"}
            </button>
            <button
              type="button"
              disabled={busy || testing}
              onClick={() => void onSaveConfig()}
              className="yt-transition rounded-full bg-[var(--brand-color)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--brand-color-emphasis)] disabled:opacity-50"
            >
              保存接入
            </button>
          </div>
        </div>
      ) : null}

      {(error || statusLine) && (
        <div
          className={[
            "flex items-start justify-between gap-3 rounded-[var(--radius-md)] border px-4 py-2.5 text-xs",
            error ? "border-rose-500/30 bg-rose-500/5 text-rose-200" : "border-[var(--border-subtle)] bg-[var(--bg-elevated)]/80 text-[var(--text-secondary)]",
          ].join(" ")}
        >
          <p className="min-w-0 flex-1">{error || statusLine}</p>
          {error ? (
            <button type="button" className="shrink-0 text-[10px] text-rose-300/80 hover:text-rose-200" onClick={() => setError("")}>
              关闭
            </button>
          ) : null}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-12">
        <div className="flex flex-col gap-4 xl:col-span-5">
          <ImageStudioCard title="创作工作台" hint="文生图或图生图，一键切换">
            <ModeSegment
              value={genMode}
              disabled={busy}
              onChange={(m) => {
                setGenMode(m);
                if (m === "text") setReferencePaths([]);
              }}
            />

            {genMode === "image" ? (
              <div className="mt-4">
                <ReferenceDropzone
                  paths={referencePaths}
                  max={IMAGE_GEN_MAX_REFERENCES}
                  disabled={busy}
                  canUseCurrent={!!selected?.path}
                  onAdd={() => void onPickReferences()}
                  onUseCurrent={onUseCurrentAsReference}
                >
                  {referencePaths.map((p, i) => (
                    <RefThumb
                      key={`${p}-${i}`}
                      path={p}
                      disabled={busy}
                      onRemove={() => setReferencePaths((prev) => prev.filter((_, idx) => idx !== i))}
                    />
                  ))}
                </ReferenceDropzone>
              </div>
            ) : null}

            <div className="mt-4 flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-[var(--text-secondary)]">
                {genMode === "image" ? "编辑指令" : "提示词"}
              </label>
              <span className="text-[10px] tabular-nums text-[var(--text-muted)]">
                {prompt.length}/{PROMPT_MAX}
              </span>
            </div>
            <textarea
              className={`${textareaClass} mt-1.5 min-h-[8.5rem]`}
              placeholder={
                genMode === "image"
                  ? "描述要如何修改参考图，例如：保持主体不变，将背景替换为科技展厅"
                  : "描述画面：主体、场景、风格、光影…"
              }
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => onPromptKeyDown(e, prompt)}
              disabled={busy}
              maxLength={PROMPT_MAX}
            />

            <div className="mt-3">
              <p className="mb-1.5 text-[10px] font-medium text-[var(--text-muted)]">灵感标签</p>
              <PromptSuggestionChips suggestions={[...suggestions]} onPick={appendSuggestion} disabled={busy} />
            </div>

            <div className="mt-4">
              <p className="mb-1.5 text-[10px] font-medium text-[var(--text-muted)]">输出尺寸</p>
              <SizeChipGroup value={size} options={IMAGE_GEN_SIZES} onChange={setSize} disabled={busy} />
            </div>

            <div className="mt-5 flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-4">
              <span className="text-[10px] text-[var(--text-muted)]">Ctrl + Enter</span>
              <button
                type="button"
                disabled={busy || testing || !prompt.trim() || (genMode === "image" && referencePaths.length === 0)}
                onClick={() => void onGenerate(prompt)}
                className="yt-transition rounded-full bg-[var(--brand-color)] px-6 py-2 text-sm font-semibold text-white shadow-[0_4px_14px_color-mix(in_oklab,var(--brand-color)_35%,transparent)] hover:bg-[var(--brand-color-emphasis)] disabled:opacity-45"
              >
                {busy ? "生成中…" : genMode === "image" ? "图生图" : "文生图"}
              </button>
            </div>
          </ImageStudioCard>
        </div>

        <div className="flex min-h-0 flex-col gap-4 xl:col-span-7">
          <div className={`${studioStageClass} relative flex min-h-[28rem] flex-col p-4`}>
            {busy ? (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-[var(--bg-base)]/78 backdrop-blur-[4px]">
                <div className="text-center">
                  <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-2 border-[var(--brand-color)] border-t-transparent" />
                  <p className="text-sm font-medium text-[var(--text-secondary)]">Seedream 绘制中</p>
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">约 1～2 分钟，请勿关闭窗口</p>
                </div>
              </div>
            ) : null}

            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">画布预览</h3>
                {selected ? (
                  <p className="mt-0.5 text-[10px] tabular-nums text-[var(--text-muted)]">
                    {formatTime(selected.createdAtMs)} · {formatBytes(selected.size)}
                    {selected.mode === "image" || (selected.referenceCount ?? 0) > 0 ? " · 图生图" : " · 文生图"}
                  </p>
                ) : (
                  <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">生成后在此查看高清结果</p>
                )}
              </div>
              {selected ? (
                <div className="flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/90 p-0.5 shadow-sm">
                  <ToolbarButton
                    label={downloading ? "保存中" : "下载"}
                    variant="primary"
                    disabled={downloading || busy}
                    icon={<IconDownload className="h-3.5 w-3.5" />}
                    onClick={() => void onDownload(selected)}
                  />
                  <ToolbarButton
                    label="作参考"
                    disabled={busy || referencePaths.length >= IMAGE_GEN_MAX_REFERENCES}
                    icon={<IconExternal className="h-3.5 w-3.5" />}
                    onClick={onUseCurrentAsReference}
                  />
                  <ToolbarButton
                    label="发对话"
                    disabled={busy}
                    icon={<IconExternal className="h-3.5 w-3.5" />}
                    onClick={onSendToChat}
                  />
                  <ToolbarButton
                    label="打开"
                    disabled={busy}
                    icon={<IconExternal className="h-3.5 w-3.5" />}
                    onClick={() => void chatOpenFile(selected.path)}
                  />
                  <ToolbarButton
                    label="删除"
                    variant="danger"
                    disabled={busy}
                    icon={<IconTrash className="h-3.5 w-3.5" />}
                    onClick={() => void onDelete(selected.id)}
                  />
                </div>
              ) : null}
            </div>

            <div className={`flex flex-1 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] ${checkerBg}`}>
              {selected ? (
                selectedSrc ? (
                  <img
                    src={selectedSrc}
                    alt={selected.prompt || selected.name}
                    className="max-h-[min(36rem,62vh)] w-full object-contain"
                  />
                ) : (
                  <p className="text-xs text-[var(--text-muted)]">{selectedPreviewFailed ? "无法预览" : "加载预览…"}</p>
                )
              ) : (
                <div className="px-8 text-center">
                  <p className="text-sm text-[var(--text-secondary)]">创作区输入提示词后开始生成</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">支持文生图与图生图，作品自动保存在本机</p>
                </div>
              )}
            </div>

            {selected ? (
              <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
                <p className="text-[10px] font-medium text-[var(--text-muted)]">修改后重新生成</p>
                <textarea
                  className={`${textareaClass} mt-1.5 min-h-[3.5rem] text-xs`}
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  onKeyDown={(e) => onPromptKeyDown(e, editPrompt)}
                  disabled={busy}
                  maxLength={PROMPT_MAX}
                />
                <button
                  type="button"
                  disabled={busy || testing || !editPrompt.trim()}
                  onClick={() => void onGenerate(editPrompt, selected.referencePaths ?? referencePaths)}
                  className="yt-transition mt-2 rounded-full border border-[var(--brand-color)]/60 px-4 py-1.5 text-xs text-[var(--brand-color)] hover:bg-[var(--brand-tint-8)] disabled:opacity-45"
                >
                  重新生成
                </button>
              </div>
            ) : null}
          </div>

          {items.length > 0 ? (
            <div className={`${panelGlass} p-3`}>
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-xs font-medium text-[var(--text-primary)]">作品序列</span>
                <span className="text-[10px] text-[var(--text-muted)]">{items.length} 张</span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1 snap-x snap-mandatory [scrollbar-width:thin]">
                {items.map((item) => (
                  <ImageThumb
                    key={item.id}
                    item={item}
                    compact
                    selected={selected?.id === item.id}
                    onSelect={() => selectItem(item)}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {items.length === 0 ? (
        <div className={`${panelGlass} py-8 text-center text-xs text-[var(--text-muted)]`}>
          暂无作品。配置 API 后即可文生图，或切换到图生图上传参考图。
        </div>
      ) : null}
      <ConfirmDialog
        open={pendingDeleteId != null}
        title="删除图片"
        titleId="image-studio-delete-title"
        variant="danger"
        confirmLabel="删除"
        disabled={busy}
        confirmLoading={busy}
        onClose={() => setPendingDeleteId(null)}
        onConfirm={confirmDelete}
      >
        确定删除这张图片？本机文件将一并移除。
      </ConfirmDialog>
    </ImageStudioShell>
  );
}
