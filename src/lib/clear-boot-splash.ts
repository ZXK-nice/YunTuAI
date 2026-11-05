/** 移除 index.html 内联启动屏，交给 React Splash 接管。 */
export function clearBootSplash(): void {
  const el = document.getElementById("boot-splash");
  if (el) el.remove();
}
