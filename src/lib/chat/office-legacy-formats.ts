/** 旧版 Office 二进制格式（.doc/.ppt 已支持本机转换预提取，不再阻断，仅在提取失败时提示另存）。 */

export function isLegacyOfficeFileName(_name: string): boolean {
  return false;
}

const LEGACY_DOC = /\.doc$/i;
const LEGACY_PPT = /\.ppt$/i;

export function legacyOfficeUserMessage(name: string): string {
  const lower = name.trim().toLowerCase();
  if (LEGACY_DOC.test(lower)) {
    return `「${name}」为旧版 Word（.doc）。本机未检测到 Word/LibreOffice 无法转换，请在 Word 中「另存为」.docx 后再上传。`;
  }
  if (LEGACY_PPT.test(lower)) {
    return `「${name}」为旧版 PowerPoint（.ppt）。本机未检测到 PowerPoint/LibreOffice 无法转换，请在 PPT 中「另存为」.pptx 后再上传。`;
  }
  return `「${name}」为旧版 Office 格式，请另存为 .docx / .pptx / .xlsx 后上传。`;
}

export function findLegacyOfficeNames(_names: readonly string[]): string[] {
  return [];
}
