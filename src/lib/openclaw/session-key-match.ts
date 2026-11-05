/** 将 Gateway WS 事件中的 sessionKey 映射到本机会话行。 */
export function findLocalSessionByRemoteKey(
  sessionKey: string,
  sessions: { id: string; remoteSessionKey: string | null }[],
) {
  const needle = sessionKey.trim();
  if (!needle) return null;
  return (
    sessions.find((s) => {
      const r = s.remoteSessionKey?.trim();
      return r && (r === needle || r.toLowerCase() === needle.toLowerCase());
    }) ?? null
  );
}
