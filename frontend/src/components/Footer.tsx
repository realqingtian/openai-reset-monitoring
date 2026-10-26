/* 页脚保留来源、使用边界与真实项目入口，避免用空链接充当网站说明。 */

import { useTranslation } from "react-i18next";
import type { Status } from "../api/types";
import { safeUrl } from "../utils/format";

const repository = "https://github.com/realqingtian/openai-reset-monitoring";

export function Footer({ status }: { status: Status | null }) {
  const { t } = useTranslation();
  const name = status?.site_name || "Codex Reset Monitor";
  const accounts = status?.accounts.length ? status.accounts : ["thsottiaux"];
  return (
    <footer className="foot" role="contentinfo" aria-label={t("footTitle")}>
      <div className="foot-main">
        <section className="foot-about" aria-label={t("footAbout")}>
          <h2>{name}</h2>
          <p>{t("footDesc")}</p>
          <p>{t("footIndependent")}</p>
        </section>
        <nav className="foot-links" aria-label={t("footResources")}>
          <h3>{t("footResources")}</h3>
          {accounts.map(account => <a key={account} href={safeUrl(`https://x.com/${encodeURIComponent(account.replace(/^@/, ""))}`)} target="_blank" rel="noopener noreferrer">{account.replace(/^@/, "") === "thsottiaux" ? t("footTiboSource") : t("footAccountSource", { account: account.replace(/^@/, "") })}</a>)}
          <a href={safeUrl("https://chatgpt.com/codex/settings/usage")} target="_blank" rel="noopener noreferrer">{t("footUsage")}</a>
          <a href={safeUrl(repository)} target="_blank" rel="noopener noreferrer">{t("footSourceCode")}</a>
          <a href={safeUrl(repository + "/issues")} target="_blank" rel="noopener noreferrer">{t("footFeedback")}</a>
        </nav>
        <section className="foot-notes" aria-label={t("footDataTitle")}>
          <h3>{t("footDataTitle")}</h3>
          <p>{t("panelDisclaimer")}</p>
          <p>{t("footForecastBoundary")}</p>
          <details className="foot-status-guide">
            <summary>{t("footStatusGuide")}</summary>
            <p>{t("footAutoTracking")}</p>
            <dl>{["scheduled", "unknown", "completed"].map(phase => <div key={phase}><dt>{t("eventPhase_" + phase)}</dt><dd>{t("eventPhaseHint_" + phase)}</dd></div>)}</dl>
          </details>
        </section>
      </div>
      <div className="foot-bottom">
        <span>{t("footMeta", { year: new Date().getFullYear(), name })}</span>
        <div className="foot-update"><span>{t("footPageRefresh")}</span>{status && <span>{t("footPollInterval", { n: status.poll_interval_minutes })}</span>}</div>
      </div>
    </footer>
  );
}
