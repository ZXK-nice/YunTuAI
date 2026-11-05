/** 与 gatewayStore.connState 对齐的展示文案（避免 store 循环依赖） */
export type GatewayConnStateWord = "disconnected" | "connecting" | "connected" | "error";

export function humanizeGatewayConn(s: GatewayConnStateWord): string {
  switch (s) {
    case "connected":
      return "服务已连接";
    case "connecting":
      return "正在连接服务…";
    case "error":
      return "服务连接异常";
    default:
      return "服务未连接";
  }
}

/** 顶栏等处的短文案（与 {@link humanizeGatewayConn} 同义，更省位） */
export function humanizeGatewayConnShort(s: GatewayConnStateWord): string {
  switch (s) {
    case "connected":
      return "已连接";
    case "connecting":
      return "连接中";
    case "error":
      return "异常";
    default:
      return "未连接";
  }
}

/** 侧栏状态点颜色类名 */
export function gatewayConnDotClass(s: GatewayConnStateWord): string {
  switch (s) {
    case "connected":
      return "bg-[var(--color-success)]";
    case "connecting":
      return "bg-[var(--color-warn)] animate-pulse";
    case "error":
      return "bg-rose-500";
    default:
      return "bg-slate-500";
  }
}
