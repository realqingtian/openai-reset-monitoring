/* 个人额度完全本地化，与公共公告分开；不请求账号接口、不上传状态文本。 */
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useTime } from "../../context/TimeContext";
import { useToast } from "../../context/ToastContext";
import { calendarFile, downloadCalendar } from "../../utils/calendar";
import { parseStatus, personalRecord, type PersonalQuota } from "./model";
const KEY = "crm-personal-quota-v1";
const fields = ["primaryUsed", "primaryReset", "secondaryUsed", "secondaryReset", "cardExpiry"] as const;
function read() { try { return personalRecord(JSON.parse(localStorage.getItem(KEY) || "null")); } catch { return null; } }
export function PersonalQuotaPanel() {
  const { t } = useTranslation(), time = useTime(), { toast } = useToast();
  const [record, setRecord] = useState(read);
  const [editing, setEditing] = useState(false);
  const [source, setSource] = useState("");
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now);
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);
  function edit() {
    setDraft(Object.fromEntries(fields.map(field => [field, field.endsWith("Used") ? String(record?.[field] ?? "") : record?.[field] ? time.stamp(record[field] as string).slice(0, 16).replace(" ", "T") : ""])));
    setMessage(""); setEditing(true);
  }
  function parse() {
    const data = parseStatus(source);
    if (!data) { setMessage("personalParseFail"); return; }
    setDraft(old => ({ ...old, ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, key.endsWith("Used") ? String(value) : time.stamp(value as string).slice(0, 16).replace(" ", "T")])) }));
    setSource(""); setMessage("personalParsed");
  }
  function save(event: FormEvent) {
    event.preventDefault();
    const data: PersonalQuota = { version: 1, primaryUsed: null, secondaryUsed: null, primaryReset: null, secondaryReset: null, cardExpiry: null, updatedAt: new Date().toISOString() };
    for (const field of fields) {
      if (!draft[field]) continue;
      if (field.endsWith("Used")) {
        const value = Number(draft[field]); if (!Number.isFinite(value) || value < 0 || value > 100) { setMessage("personalInvalid"); return; }
        data[field as "primaryUsed" | "secondaryUsed"] = value;
      } else {
        const date = new Date(draft[field] + (time.mode === "utc" ? "Z" : ""));
        if (!Number.isFinite(date.getTime())) { setMessage("personalInvalid"); return; }
        data[field as "primaryReset" | "secondaryReset" | "cardExpiry"] = date.toISOString();
      }
    }
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { setMessage("personalStorageFail"); return; }
    setRecord(data); setEditing(false); setSource(""); toast(t("personalSaved"), true);
  }
  function clear() {
    try { localStorage.removeItem(KEY); } catch { toast(t("personalStorageFail"), false); return; }
    setRecord(null); setEditing(false); setSource(""); setDraft({}); toast(t("personalCleared"), true);
  }
  const deadlines = fields.filter(field => !field.endsWith("Used") && record?.[field]).map(field => ({ field, at: record![field] as string }));
  const summary = record ? [t("personalTitle"), ...fields.filter(field => record[field] != null).map(field => `${t("personal_" + field)}: ${field.endsWith("Used") ? record[field] + "%" : time.stamp(record[field] as string) + " · " + time.label}`), `${t("personalUpdated")}: ${time.stamp(record.updatedAt)}`].join("\n") : "";
  return <section className="personal-quota" aria-label={t("personalTitle")}>
    <div className="monitor-summary-heading"><h2>{t("personalTitle")}</h2><button type="button" className="btn btn-ghost" onClick={edit}>{t(record ? "personalEdit" : "personalAdd")}</button></div>
    <p className="event-boundary">{t("personalPrivacy")}</p>
    {record ? <>
      <div className="personal-windows">{(["primary", "secondary"] as const).map(window => { const used = record[window === "primary" ? "primaryUsed" : "secondaryUsed"]; return <div key={window}><h3>{t(window === "primary" ? "personalPrimary" : "personalSecondary")}</h3>{used != null ? <><strong>{t("personalUsage", { n: used })}</strong><progress max={100} value={used} aria-label={t(window === "primary" ? "personalPrimary" : "personalSecondary")} /></> : <span>{t("personalUnknown")}</span>}</div>; })}</div>
      <dl className="personal-deadlines">{deadlines.map(({ field, at }) => <div key={field}><dt>{t("personal_" + field)}</dt><dd><time dateTime={at}>{time.stamp(at)} · {time.label}</time><span className={Date.parse(at) <= now ? "personal-due" : ""}>{t(Date.parse(at) <= now ? "personalDue" : "personalInHours", { n: Math.max(1, Math.ceil((Date.parse(at) - now) / 3600000)) })}</span></dd></div>)}</dl>
      <p className="event-boundary">{t("personalUpdated")}: {time.stamp(record.updatedAt)} · {t("personalReminderBoundary")}</p>
      <div className="monitor-actions"><button className="btn btn-ghost" type="button" onClick={() => void navigator.clipboard.writeText(summary).then(() => toast(t("personalCopied"), true)).catch(() => toast(t("personalCopyFail"), false))}>{t("personalCopy")}</button><button className="btn btn-ghost" type="button" disabled={!deadlines.length} onClick={() => downloadCalendar(calendarFile(deadlines.map(({field, at}) => ({id: `personal-${field}`, at, title: t("personal_"+field), description: t("personalExportBoundary")}))), "personal-quota.ics")}>{t("personalExport")}</button><button className="btn btn-ghost" type="button" onClick={clear}>{t("personalClear")}</button></div>
    </> : <p>{t("personalEmpty")}</p>}
    {editing && <form className="personal-form" onSubmit={save}>
      <p>{time.label} · {t("personalInputBoundary")}</p>
      <div className="personal-inputs">{fields.map(field => <label key={field}>{t("personal_" + field)}<input type={field.endsWith("Used") ? "number" : "datetime-local"} min={field.endsWith("Used") ? 0 : undefined} max={field.endsWith("Used") ? 100 : undefined} step={field.endsWith("Used") ? "0.1" : 60} value={draft[field] || ""} onChange={e => setDraft(old => ({ ...old, [field]: e.target.value }))} /></label>)}</div>
      <details><summary>{t("personalParse")}</summary><p>{t("personalParseHint")}</p><label>{t("personalStatusText")}<textarea maxLength={50000} rows={5} value={source} onChange={e => setSource(e.target.value)} /></label><button type="button" className="btn btn-ghost" onClick={parse}>{t("personalParseAction")}</button></details>
      {message && <p role="status">{t(message)}</p>}
      <div className="monitor-actions"><button className="btn btn-primary" type="submit">{t("personalSave")}</button><button className="btn btn-ghost" type="button" onClick={() => { setEditing(false); setSource(""); }}>{t("personalCancel")}</button></div>
    </form>}
  </section>;
}
