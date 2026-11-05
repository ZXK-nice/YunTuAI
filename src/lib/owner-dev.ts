/** Vite 浏览器预览（非 Tauri）时在 DEV 下跳过 Owner 门控，便于纯前端开发。 */
export function isFrontendDevOwnerBypass(): boolean {
  return import.meta.env.DEV;
}
