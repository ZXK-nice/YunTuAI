import { getStepIngestGraceUntil } from "../lib/openclaw/gateway-shared-state";
import { useSessionStore } from "./sessionStore";
import { useStepStore } from "./stepStore";
import { useWorkspaceArtifactStore } from "./workspaceArtifactStore";
import { STEP_INGEST_FLUSH_MS } from "./gateway-store-constants";

let stepIngestQueue: Array<{ event: string; payload: unknown }> = [];
let stepIngestFlushTimer: ReturnType<typeof setTimeout> | null = null;

export function shouldIngestSteps(): boolean {
  return useSessionStore.getState().isSending || Date.now() < getStepIngestGraceUntil();
}

function flushStepIngestQueue() {
  stepIngestFlushTimer = null;
  const batch = stepIngestQueue.splice(0);
  const session = useSessionStore.getState();
  const activeId = session.sendingSessionId ?? session.activeId;
  for (const item of batch) {
    useStepStore.getState().ingestGatewayEvent(item.event, item.payload);
    if (activeId) {
      useWorkspaceArtifactStore.getState().ingestGatewayEvent(activeId, item.event, item.payload);
    }
  }
  if (!useSessionStore.getState().isSending) {
    useStepStore.getState().finalizeStaleRunningSteps();
  }
}

export function queueStepIngest(event: string, payload: unknown) {
  stepIngestQueue.push({ event, payload });
  if (stepIngestFlushTimer != null) return;
  stepIngestFlushTimer = setTimeout(flushStepIngestQueue, STEP_INGEST_FLUSH_MS);
}

export function clearStepIngestQueue() {
  stepIngestQueue = [];
  if (stepIngestFlushTimer) {
    clearTimeout(stepIngestFlushTimer);
    stepIngestFlushTimer = null;
  }
}
