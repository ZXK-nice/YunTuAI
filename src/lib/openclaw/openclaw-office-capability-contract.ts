/**
 * YunTuAI 办公 / OCR 能力与 OpenClaw 网关的 metadata + skill 契约。
 */
import type { OfficeAttachmentKind } from "../chat/office-workbench";
import { OFFICE_EXECUTION_CONTRACT } from "../chat/office-workbench";

export const YUNTUAI_OFFICE_CAPABILITY_VERSION = "1";

export const YUNTUAI_OFFICE_SKILL_IDS: Record<OfficeAttachmentKind, string> = {
  spreadsheet: "yuntuai-office-xlsx",
  document: "yuntuai-office-docx",
  presentation: "yuntuai-office-pptx",
  pdf: "yuntuai-office-pdf",
  csv: "yuntuai-office-csv",
  image: "yuntuai-ocr",
};

export const YUNTUAI_OFFICE_PRE_EXTRACT_MARKERS = [
  "【OCR",
  "【表格预提取】",
  "【PDF 预提取】",
  "【提取正文】",
  "【OCR 预识别】",
  "【文档预提取】",
] as const;

export type OfficeCapabilityContract = {
  version: string;
  skillIds: string[];
  preExtractMarkers: readonly string[];
  executionContract: string;
};

export function buildOfficeCapabilityContract(
  kinds: OfficeAttachmentKind[],
): OfficeCapabilityContract | null {
  if (!kinds.length) return null;
  const skillIds = [...new Set(kinds.map((k) => YUNTUAI_OFFICE_SKILL_IDS[k]).filter(Boolean))];
  if (!skillIds.length) return null;
  return {
    version: YUNTUAI_OFFICE_CAPABILITY_VERSION,
    skillIds,
    preExtractMarkers: YUNTUAI_OFFICE_PRE_EXTRACT_MARKERS,
    executionContract: OFFICE_EXECUTION_CONTRACT,
  };
}

export function officeCapabilityToMetadata(
  contract: OfficeCapabilityContract,
): Record<string, unknown> {
  return {
    yuntuaiOfficeContractVersion: contract.version,
    yuntuaiOfficeSkills: contract.skillIds,
    yuntuaiOfficePreExtractMarkers: [...contract.preExtractMarkers],
    yuntuaiOfficeExecutionContract: contract.executionContract.slice(0, 500),
  };
}
