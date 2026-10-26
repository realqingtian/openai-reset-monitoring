import { describe, expect, test } from "bun:test";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { TimeProvider } from "../src/context/TimeContext";
import { ForecastSummary } from "../src/features/forecast/ForecastSummary";
import type { ResetForecast } from "../src/api/types";
import zh from "../src/i18n/locales/zh";
import en from "../src/i18n/locales/en";

const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "zh", resources: { zh: { translation: zh }, en: { translation: en } }, interpolation: { escapeValue: false } });
const base: ResetForecast = { status: "unavailable", method: "ai_history", confidence: "none", reason_code: "timezone_unknown", sample_events: 6, sample_posts: 18, evidence: [] };
const preview = { id: "preview", account: "fixture", text: "But today is a reset.", url: "https://example.com/post", published_at: new Date(Date.now() - 3600000).toISOString(), timing: "same_day" as const };
const render = (forecast: ResetForecast) => renderToStaticMarkup(<I18nextProvider i18n={i18n}><TimeProvider><ForecastSummary forecast={forecast} compact /></TimeProvider></I18nextProvider>);

describe("next reset information hierarchy", () => {
  test("untimed preview keeps timing uncertain with evidence collapsed by default", () => {
    const html = render({ ...base, pending_preview: preview });
    expect(html).toContain("下次重置时间待定");
    expect(html).toContain("来源提到发帖当天重置，具体时间与时区未明确。");
    expect(html).toContain("But today is a reset.");
    expect(html).not.toContain("暂无可靠预测");
    expect(html).not.toContain('class="forecast-outlook forecast-window"');
    expect(html).toContain('href="https://example.com/post"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('hidden=""');
  });
  test("old same-day wording is not presented as a new promise for today", () => {
    const html = render({ ...base, pending_preview: { ...preview, published_at: new Date(Date.now() - 25 * 3600000).toISOString() } });
    expect(html).toContain("下次重置时间待定");
    expect(html).toContain("此前消息尚无后续完成确认");
    expect(html).not.toContain("提到帖文发布当天重置");
  });
  test("active windows are the primary value and expired windows stop being forecasts", () => {
    const future = { ...base, status: "estimated" as const, reason_code: "cadence", confidence: "low", window_start: new Date(Date.now() + 3600000).toISOString(), window_end: new Date(Date.now() + 7200000).toISOString() };
    const active = render(future);
    expect(active).toContain('class="forecast-outlook forecast-window"');
    expect(active).toContain("历史推算");
    expect(active).toContain("预计重置窗口");
    expect(active).toContain("<span>预计</span>");
    const expired = render({ ...future, window_start: new Date(Date.now() - 7200000).toISOString(), window_end: new Date(Date.now() - 3600000).toISOString() });
    expect(expired).toContain("等待新的重置时间");
    expect(expired).not.toContain('class="forecast-outlook forecast-window"');
  });
  test("missing previews remain honest and untrusted source content is escaped", () => {
    expect(render(base)).toContain("下次重置时间待定");
    const html = render({ ...base, pending_preview: { ...preview, text: '<img src=x onerror="unsafe">', url: "javascript:unsafe" } });
    expect(html).not.toContain('<img src="x"');
    expect(html).toContain("&lt;img");
    expect(html).not.toContain('href="javascript:unsafe"');
  });
});
