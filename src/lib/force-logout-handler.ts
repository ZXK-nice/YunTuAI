/**
 * 全局强制登出回调。
 * AppShell 设置该回调以显示确认弹窗，替代静默登出。
 */

type ForceLogoutCallback = (reason: string) => void;

let _handler: ForceLogoutCallback | null = null;

export function setForceLogoutHandler(h: ForceLogoutCallback | null): void {
  _handler = h;
}

export function triggerForceLogout(reason: string): void {
  if (_handler) {
    _handler(reason);
  }
}