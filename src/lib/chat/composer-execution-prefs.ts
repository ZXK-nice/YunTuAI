const STORAGE_KEY = "yuntu-composer-local-only-v1";

export function readLocalOnlyMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function persistLocalOnlyMode(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** 输入含敏感词时建议开启仅本机模式 */
export function shouldSuggestLocalOnly(text: string): boolean {
  return /财务|合同|密码|密钥|内网|报销|工资|薪资|身份证|银行卡|机密|保密|审计|凭证|账套|erp|人事档案/i.test(
    text.trim(),
  );
}
