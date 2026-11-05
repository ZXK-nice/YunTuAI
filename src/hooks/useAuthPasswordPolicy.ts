import { useEffect, useState } from "react";
import {
  DIRECT_PASSWORD_HINT,
  validateLoginPassword,
} from "../lib/auth-password-policy";
import { fetchDistributionProfile } from "../lib/openclaw/env-bridge";

/** 与 LoginScreen / 改密 / Owner 重置共用：按发行档返回密码规则。 */
export function useAuthPasswordPolicy() {
  const [openRegistration, setOpenRegistration] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchDistributionProfile()
      .then((p) => {
        if (cancelled) return;
        setOpenRegistration(Boolean(p?.openRegistration));
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hint = DIRECT_PASSWORD_HINT;

  return {
    openRegistration,
    ready,
    hint,
    validate: (password: string) => validateLoginPassword(password, openRegistration),
    maxLength: 128,
    inputMode: undefined,
  };
}
