/* 顶部告警横幅：24h 命中状态、最近检查时间、命中推文直达链接。 */

import { useTranslation } from "react-i18next";
import { SVG_ALERT, SVG_OK, SVG_LINK } from "../../components/icons";
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
        <div className="hero-copy">
          <span className="eyebrow">
            <span className={"pulse-dot " + (hit ? "red" : "green")} />
            <span>{hit ? t("alertState") : t("monitoring")}</span>
          </span>
          <h1 className="hero-status">{hit ? t("hitDetected", { n: status?.hit_count_24h ?? 0 }) : t("noHit")}</h1>
          <div className="hero-sub">
            {t("heroSub", {
              acc: (status?.accounts || []).map((a) => "@" + a).join(lang === "zh" ? "、" : ", "),
              ago: ago(status?.last_poll_at, lang),
            })}
          </div>
        </div>
        {hit && status?.latest_hit && (
          <div className="hero-link-row">
            <a className="btn btn-ghost" href={safeUrl(status.latest_hit.url)} target="_blank" rel="noopener">
              <span>{t("viewHit")}</span>
              <span className="btn-orb">
                <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: SVG_LINK }} />
              </span>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
