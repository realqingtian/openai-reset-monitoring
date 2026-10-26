/* 管理员人工判断另存审计；加载时取修订号，冲突后要求刷新，不静默覆盖。 */
import { NativeSelect } from "../../components/NativeSelect";
import { useEffect, useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { j } from "../../api/client";
import type { ResetEvent } from "../../api/types";
import { useAuth } from "../../context/AuthContext";
import { useTime } from "../../context/TimeContext";
interface Audit { revision: number; items: {id: number; actor: string; action: string; event_id: string; reason: string; created_at: string; payload: { target_id?: string } }[]; withdrawn: {id: string; account: string; text: string}[]; }
export function EventReviewPanel({ events, onSaved }: { events: ResetEvent[]; onSaved: () => void }) {
  const { t } = useTranslation(), auth = useAuth(), time = useTime();
  const selectId = useId();
  const [data, setData] = useState<Audit | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [selected, setSelected] = useState(events[0]?.id || ""), [action, setAction] = useState("classify"), [kind, setKind] = useState(events[0]?.kind || "quota"), [phase, setPhase] = useState(events[0]?.phase || "unknown"), [target, setTarget] = useState(""), [reason, setReason] = useState("");
  async function load() {
    setBusy(true);
    try { const audit = await auth.guard(() => j<Audit>("/api/admin/event-reviews?limit=50")); setData(audit); setMessage(""); }
    catch { setMessage("reviewLoadFail"); } finally { setBusy(false); }
  }
  useEffect(() => { let alive = true; queueMicrotask(() => { if (alive) void load(); }); return () => { alive = false; }; }, []); // oxlint-disable-line react-hooks/exhaustive-deps -- 打开时读取一次，后续显式刷新修订。
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!data || busy) return;
    setBusy(true); setMessage("");
    try {
      await auth.guard(() => j("/api/admin/event-reviews", { method: "POST", body: JSON.stringify({ action, event_id: selected, target_id: target || null, kind, phase, reason, expected_revision: data.revision }) }));
      setReason(""); await load(); setMessage("reviewSaved"); onSaved();
    } catch { setMessage("reviewSaveFail"); } finally { setBusy(false); }
  }
  return <div className="event-review"><h3>{t("reviewTitle")}</h3><p className="event-boundary">{t("reviewBoundary")}</p><button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void load()}>{t("reviewRefresh")}</button>
    {message && <p role="status">{t(message)}</p>}
    {data && <><form onSubmit={submit}><div className="personal-inputs">
      <div className="select-field"><label htmlFor={selectId + "-action"}>{t("reviewAction")}</label><NativeSelect id={selectId + "-action"} aria-label={t("reviewAction")} value={action} onChange={e => setAction(e.target.value)}>{["classify","merge","unmerge","withdraw","restore"].map(value => <option key={value} value={value}>{t("reviewAction_"+value)}</option>)}</NativeSelect></div>
      <div className="select-field"><label htmlFor={selectId + "-event"}>{t("reviewEvent")}</label><NativeSelect id={selectId + "-event"} aria-label={t("reviewEvent")} value={selected} onChange={e => { const event = events.find(row => row.id === e.target.value); setSelected(e.target.value); if (event) { setKind(event.kind); setPhase(event.phase); } }}><option value="">{t("reviewSelect")}</option>{events.map(row => <option value={row.id} key={row.id}>{row.id} · @{row.account} · {time.stamp(row.announced_at)}</option>)}{data.withdrawn.filter(row => !events.some(event => event.id === row.id)).map(row => <option key={row.id} value={row.id}>{row.id} · {t("reviewWithdrawn")} · @{row.account}</option>)}</NativeSelect></div>
      {action === "classify" && <><div className="select-field"><label htmlFor={selectId + "-kind"}>{t("eventFilterKind")}</label><NativeSelect id={selectId + "-kind"} aria-label={t("eventFilterKind")} value={kind} onChange={e => setKind(e.target.value as ResetEvent["kind"])}>{["quota","card","other"].map(value => <option key={value} value={value}>{t("eventKind_"+value)}</option>)}</NativeSelect></div><div className="select-field"><label htmlFor={selectId + "-phase"}>{t("eventFilterPhase")}</label><NativeSelect id={selectId + "-phase"} aria-label={t("eventFilterPhase")} value={phase} onChange={e => setPhase(e.target.value as ResetEvent["phase"])}>{["completed","scheduled","unknown"].map(value => <option key={value} value={value}>{t("eventPhase_"+value)}</option>)}</NativeSelect></div></>}
      {(action === "merge" || action === "unmerge") && <label>{t(action === "merge" ? "reviewTarget" : "reviewOriginalSource")}<input maxLength={200} value={action === "merge" ? target : selected} onChange={e => action === "merge" ? setTarget(e.target.value) : setSelected(e.target.value)} required /></label>}
    </div><label>{t("reviewReason")}<textarea rows={3} minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} required /></label><button className="btn btn-primary" type="submit" disabled={!selected || busy}>{t(busy ? "monitorLoading" : "reviewApply")}</button></form>
    <details className="review-audit"><summary>{t("reviewAudit", { n: data.items.length })}</summary>{data.items.map(row => <article key={row.id}><p>#{row.id} · {time.stamp(row.created_at)} · {row.actor}</p><strong>{t("reviewAction_"+row.action)} · {row.event_id}{row.payload.target_id ? ` → ${row.payload.target_id}` : ""}</strong><p>{row.reason}</p></article>)}</details></>}
  </div>;
}
