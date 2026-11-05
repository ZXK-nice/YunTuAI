import { useEffect, useState } from "react";
import { chatReadFileBase64 } from "../lib/chat/chat-files-bridge";
import { isTauriRuntime } from "../lib/tauri-env";

type CacheEntry = { url: string; kind: "blob" | "asset" };

const previewCache = new Map<string, CacheEntry>();
const MAX_CACHE = 64;
const MAX_CONCURRENT = 3;

let activeLoads = 0;
const waitQueue: Array<() => void> = [];

function runNextQueued() {
  if (activeLoads >= MAX_CONCURRENT || waitQueue.length === 0) return;
  const next = waitQueue.shift();
  next?.();
}

function withLoadSlot<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeLoads += 1;
      void task()
        .then(resolve, reject)
        .finally(() => {
          activeLoads -= 1;
          runNextQueued();
        });
    };
    if (activeLoads < MAX_CONCURRENT) run();
    else waitQueue.push(run);
  });
}

function revokeEntry(entry: CacheEntry) {
  if (entry.kind === "blob" && entry.url.startsWith("blob:")) {
    URL.revokeObjectURL(entry.url);
  }
}

function cacheSet(path: string, entry: CacheEntry) {
  if (previewCache.size >= MAX_CACHE) {
    const first = previewCache.keys().next().value;
    if (first) {
      const old = previewCache.get(first);
      if (old) revokeEntry(old);
      previewCache.delete(first);
    }
  }
  previewCache.set(path, entry);
}

async function resolvePreviewUrl(path: string): Promise<string | null> {
  const cached = previewCache.get(path);
  if (cached) return cached.url;

  if (isTauriRuntime()) {
    try {
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      const assetUrl = convertFileSrc(path);
      cacheSet(path, { url: assetUrl, kind: "asset" });
      return assetUrl;
    } catch {
      /* fallback to IPC base64 */
    }
  }

  const payload = await chatReadFileBase64(path);
  if (!payload?.base64) return null;

  const binary = atob(payload.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: payload.mimeType || "image/jpeg" });
  const blobUrl = URL.createObjectURL(blob);
  cacheSet(path, { url: blobUrl, kind: "blob" });
  return blobUrl;
}

export function clearImagePreviewCache(path?: string) {
  if (path) {
    const entry = previewCache.get(path);
    if (entry) revokeEntry(entry);
    previewCache.delete(path);
    return;
  }
  for (const entry of previewCache.values()) revokeEntry(entry);
  previewCache.clear();
}

export function useImageFilePreview(path: string | null | undefined, enabled = true) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!path || !enabled) {
      setSrc("");
      setFailed(false);
      return;
    }
    const cached = previewCache.get(path);
    if (cached) {
      setSrc(cached.url);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setSrc("");
    setFailed(false);
    void withLoadSlot(() => resolvePreviewUrl(path))
      .then((url) => {
        if (cancelled) return;
        if (!url) {
          setFailed(true);
          return;
        }
        setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [path, enabled]);

  return { src, failed };
}
