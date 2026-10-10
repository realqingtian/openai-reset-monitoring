/* 通知测试与系统状态同页，沿用原有鉴权和按渠道反馈。 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, j } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useLang } from "../i18n/useLang";

export function TestNotifyButton() {
  const { t } = useTranslation();
  const lang = useLang();
  const auth = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  async function testNotify() {
    if (busy) return;
    setBusy(true);
    try {
      const results = await auth.guard(() =>
        j<{ channel: string; ok: boolean; error?: string }[]>("/api/test-notify", { method: "POST" }),
      );
      if (!results.length) {
        toast(t("toastNoChannel"), false);
        return;
      }
      const fails = results.filter((r) => !r.ok);
      const chs = results.map((r) => r.channel).join(lang === "zh" ? "、" : ", ");
      toast(
        fails.length
          ? t("toastSendFail", { e: fails.map((f) => f.channel).join(", ") + (fails[0].error ? " " + fails[0].error : "") })
          : t("toastSent", { n: results.length, chs }),
        !fails.length,
      );
    } catch (e) {
      const authFail = e instanceof ApiError && e.auth;
      toast(authFail ? t("toastNeedLogin") : t("toastSendFail", { e: (e as Error).message }), false);
    } finally {
      setBusy(false);
    }
  }

  return <button className="btn btn-primary" type="button" disabled={busy} title={t("debugBtnTip")} onClick={() => void testNotify()}>{t(busy ? "sendingNotify" : "testNotify")}</button>;
}
