/** Token 仅通过 WebSocket connect 帧传递，避免 URL 与 body 双通道不一致。 */
export function buildGatewayWsUrl(host: string, port: number): string {
  const h = host.trim() || "127.0.0.1";
  return `ws://${h}:${port}`;
}