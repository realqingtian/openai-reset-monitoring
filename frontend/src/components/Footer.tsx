/* 页脚：说明与版权。 */

import { useTranslation } from "react-i18next";
import type { Status } from "../api/types";

export function Footer({ status }: { status: Status | null }) {
  const { t } = useTranslation();
  return (
    <footer className="foot">
      <div className="foot-desc">{t("footDesc", { n: status?.poll_interval_minutes ?? 5 })}</div>
      <div className="foot-meta">
        <span>{t("footMeta", { year: new Date().getFullYear(), name: status?.site_name || "Reset Monitor" })}</span>
      </div>
    </footer>
  );
}
