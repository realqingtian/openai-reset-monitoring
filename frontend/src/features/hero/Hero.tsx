/* 顶部告警横幅：24h 命中状态、最近检查时间、命中推文直达链接。 */

import { useTranslation } from "react-i18next";
import { SVG_ALERT, SVG_OK } from "../../components/icons";
import type { Status } from "../../api/types";
import { ago, safeUrl } from "../../utils/format";
import { useLang } from "../../i18n/useLang";

export function Hero({ status }: { status: Status | null }) {
  const { t } = useTranslation();
  const lang = useLang();
  const hit = (status?.hit_count_24h ?? 0) > 0;

  return (
    <div className={"card in" + (hit ? " hit" : "")} id="hero">
      <div className="card-core hero-core">
        <div className="hero-glyph" aria-hidden dangerouslySetInnerHTML={{ __html: hit ? SVG_ALERT : SVG_OK }} />
        <div>
          <span className="eyebrow">
            <span className={"pulse-dot " + (hit ? "red" : "green")} />
            <span>{hit ? t("alertState") : t("monitoring")}</span>
          </span>
        </div>
        <div className="hero-status">{hit ? t("hitDetected", { n: status?.hit_count_24h ?? 0 }) : t("noHit")}</div>
        <div className="hero-sub">
          {t("heroSub", {
            acc: (status?.accounts || []).map((a) => "@" + a).join(lang === "zh" ? "、" : ", "),
            ago: ago(status?.last_poll_at, lang),
          })}
        </div>
        <div className="hero-link-row">
          {hit && status?.latest_hit && (
            <a className="btn btn-ghost" href={safeUrl(status.latest_hit.url)} target="_blank" rel="noopener">
              <span>{t("viewHit")}</span>
              <span className="btn-orb">
                <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4.5 11.5 11.5 4.5M5.5 4.5h6v6" />
                </svg>
              </span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
