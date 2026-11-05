import { invokeAuthed } from "../tauri-invoke";
import { isTauriRuntime } from "../tauri-env";

export type LoopEngineeringStatus = {
  heartbeatPresent: boolean;
  improvementsPresent: boolean;
  agentsPresent: boolean;
  heartbeatConfigured: boolean;
  improvementsPreview: string;
  improvementsLineCount: number;
  loopBootstrapped: boolean;
};

export async function fetchLoopEngineeringStatus(): Promise<LoopEngineeringStatus | null> {
  if (!isTauriRuntime()) return null;
  return invokeAuthed<LoopEngineeringStatus>("loop_engineering_status_cmd", {});
}
