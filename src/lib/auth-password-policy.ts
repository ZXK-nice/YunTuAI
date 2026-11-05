/** 与 `distribution_policy::uses_eight_digit_login_password` / `auth.rs` 对齐。中转站与内部版同一规则。 */

export const DIRECT_PASSWORD_HINT = "至少 8 位，需含英文字母和数字";

export function validateLoginPassword(password: string, _openRegistration = false): string | null {
  const p = password.trim();
  if (p.length < 8) return "密码至少需要 8 个字符";
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) {
    return "密码必须同时包含英文字母和数字";
  }
  return null;
}
