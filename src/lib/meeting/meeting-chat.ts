import type { MeetingLiveState } from "./meeting-bridge";
import {
  buildMeetingChatText,
  buildMeetingContextCard,
} from "../chat/context-cards";

/** @deprecated 使用 buildMeetingChatText + buildMeetingContextCard */
export function buildMeetingChatPrompt(live: MeetingLiveState): string {
  return buildMeetingChatText(live);
}

export { buildMeetingChatText, buildMeetingContextCard };
