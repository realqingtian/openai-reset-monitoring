/* 访客能力令牌与管理员登录隔离；URL 片段在读取后清除，令牌只放 POST 包体。 */
import { NativeSelect } from "../../components/NativeSelect";
import { useEffect, useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { j } from "../../api/client";
import { useLang } from "../../i18n/useLang";
import { useToast } from "../../context/ToastContext";
interface Options { enabled: boolean; email: boolean; webpush: boolean; vapid_public_key: string | null; }
interface Preferences { kinds: string[]; phases: string[]; lang: "zh" | "en"; }
interface Management { active: boolean; channel: string; preferences: Preferences; deliveries: {state: string; attempts: number; updated_at: string}[]; }
function readTokens(): Record<string,string> { try { const data = JSON.parse(localStorage.getItem("crm-subscription-tokens") || "{}"); return Object.fromEntries(Object.entries(data).filter(([key,value]) => ["email","webpush"].includes(key) && typeof value === "string" && /^[\w.-]{40,300}$/.test(value))) as Record<string,string>; } catch { return {}; } }
export function PublicSubscriptionsPanel() {
  const { t } = useTranslation(), lang = useLang(), { toast } = useToast();
  const channelSelectId = useId();
  const [options, setOptions] = useState<Options | null>(null), [tokens, setTokens] = useState(readTokens), [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [email, setEmail] = useState(""), [consent, setConsent] = useState(false), [kinds, setKinds] = useState(["quota","card"]), [phases, setPhases] = useState(["completed"]);
  const [channel, setChannel] = useState(() => Object.keys(readTokens())[0] || "webpush"), [management, setManagement] = useState<Management | null>(null);
  const [supported] = useState(() => window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
  const preferences: Preferences = { kinds, phases, lang };
  function remember(key: string, token: string | null) {
    setTokens(old => { const next = { ...old }; if (token) next[key] = token; else delete next[key]; try { localStorage.setItem("crm-subscription-tokens", JSON.stringify(next)); } catch { toast(t("publicStorageFail"), false); } return next; });
  }
  useEffect(() => {
    const controller = new AbortController();
    void j<Options>("/api/subscriptions/options", { signal: controller.signal }).then(setOptions).catch(() => { if (!controller.signal.aborted) setMessage("publicLoadFail"); });
    queueMicrotask(() => {
    if (controller.signal.aborted) return;
    const fragment = new URLSearchParams(location.hash.slice(1));
    const confirm = fragment.get("email-confirm"), token = fragment.get("subscription");
    if (confirm || token) {
      history.replaceState(null, "", location.pathname + location.search + "#visitor-subscriptions"); setOpen(true);
      if (token) { setChannel("email"); remember("email", token); }
      if (confirm) {
        setBusy(true);
        void j<{token: string}>("/api/subscriptions/confirm", {method: "POST", body: JSON.stringify({token:confirm})}).then(data => { remember("email", data.token); setChannel("email"); setMessage("publicConfirmed"); }).catch(() => setMessage("publicConfirmFail")).finally(() => setBusy(false));
      }
    }
    });
    return () => controller.abort();
  }, []); // oxlint-disable-line react-hooks/exhaustive-deps -- URL 片段只消费一次，后续不重复确认。
  useEffect(() => {
    const token = tokens[channel]; if (!open || !token || !options?.enabled) return;
    const controller = new AbortController();
    void j<Management>("/api/subscriptions/manage", {method:"POST",body:JSON.stringify({token}),signal:controller.signal}).then(data => { if (!controller.signal.aborted) { setManagement(data); setKinds(data.preferences.kinds); setPhases(data.preferences.phases); } }).catch(() => { if (!controller.signal.aborted) setMessage("publicManageFail"); });
    return () => controller.abort();
  }, [channel, tokens, options?.enabled, open]);
  function valid() { if (!consent || !kinds.length || !phases.length) { setMessage("publicNeedConsent"); return false; } return true; }
  async function subscribeEmail(event: FormEvent) {
    event.preventDefault(); if (!valid() || !options?.email) return; setBusy(true); setMessage("");
    try { await j("/api/subscriptions/email",{method:"POST",body:JSON.stringify({email,preferences,consent:true})}); setEmail(""); setMessage("publicEmailRequested"); }
    catch { setMessage("publicSubscribeFail"); } finally { setBusy(false); }
  }
  async function subscribePush() {
    if (!valid() || !supported || !options?.webpush || !options.vapid_public_key) return;
    setBusy(true); setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setMessage("publicPermissionDenied"); return; }
      const registration = await navigator.serviceWorker.register("/service-worker.js", {scope:"/"});
      await navigator.serviceWorker.ready;
      const publicKey = options.vapid_public_key.replace(/-/g,"+").replace(/_/g,"/");
      const key = Uint8Array.from(atob(publicKey + "=".repeat((4-publicKey.length%4)%4)), c => c.charCodeAt(0));
      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
      const raw = subscription.toJSON();
      const result = await j<{token:string}>("/api/subscriptions/webpush",{method:"POST",body:JSON.stringify({subscription:{endpoint:raw.endpoint,keys:raw.keys},preferences,consent:true})});
      remember("webpush", result.token); setChannel("webpush"); setMessage("publicPushSubscribed");
    } catch { setMessage("publicSubscribeFail"); } finally { setBusy(false); }
  }
  async function update(unsubscribe: boolean) {
    const token = tokens[channel]; if (!token || (!unsubscribe && (!kinds.length || !phases.length))) return;
    setBusy(true);
    try {
      const data = await j<Management>(`/api/subscriptions/${unsubscribe ? "unsubscribe" : "preferences"}`,{method:"POST",body:JSON.stringify(unsubscribe ? {token} : {token,preferences})});
      if (unsubscribe) {
        remember(channel, null); setManagement(null);
        if (channel === "webpush") { const registration = await navigator.serviceWorker.getRegistration(); const subscription = await registration?.pushManager.getSubscription(); await subscription?.unsubscribe(); }
      } else setManagement(data);
      setMessage(unsubscribe ? "publicUnsubscribed" : "publicPreferencesSaved");
    } catch { setMessage("publicManageFail"); } finally { setBusy(false); }
  }
  const toggle = (list: string[], value: string) => list.includes(value) ? list.filter(item=>item!==value) : [...list,value];
  return <section id="visitor-subscriptions" className="public-subscriptions" aria-label={t("publicTitle")}><details open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary>{t("publicTitle")}</summary><p className="event-boundary">{t("publicBoundary")}</p>
    {!options && <p role="status">{t("monitorLoading")}</p>}
    {options && <><div className="monitor-channel-list"><span>{t("publicEmail")} · {t(options.email ? "ntReady" : "stUnconfigured")}</span><span>Web Push · {t(!options.webpush ? "stUnconfigured" : supported ? "ntReady" : "publicUnsupported")}</span></div>
      {!options.enabled && <p>{t("publicNotConfigured")}</p>}
      <fieldset className="public-preferences"><legend>{t("publicPreferences")}</legend><div>{["quota","card"].map(kind=><label key={kind}><input type="checkbox" checked={kinds.includes(kind)} onChange={()=>setKinds(toggle(kinds,kind))} />{t("eventKind_"+kind)}</label>)}</div><div>{["completed","scheduled"].map(phase=><label key={phase}><input type="checkbox" checked={phases.includes(phase)} onChange={()=>setPhases(toggle(phases,phase))} />{t("eventPhase_"+phase)}</label>)}</div></fieldset>
      <label className="public-consent"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)} />{t("publicConsent")}</label>
      <form className="public-email-form" onSubmit={subscribeEmail}><label>{t("publicEmailAddress")}<input type="email" required maxLength={254} autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} disabled={!options.email} /></label><button className="btn btn-ghost" type="submit" disabled={busy || !options.email || !consent}>{t("publicRequestEmail")}</button></form>
      <button className="btn btn-ghost" type="button" onClick={()=>void subscribePush()} disabled={busy || !options.webpush || !supported || !consent}>{t("publicEnablePush")}</button><p className="event-boundary">{t("publicPushHint")}</p>
      {!!Object.keys(tokens).length && <div className="public-management"><div className="select-field"><label htmlFor={channelSelectId}>{t("publicManageChannel")}</label><NativeSelect id={channelSelectId} aria-label={t("publicManageChannel")} value={channel} onChange={event=>{setManagement(null);setChannel(event.target.value);}}><option value="">{t("publicSelectChannel")}</option>{Object.keys(tokens).map(key=><option key={key} value={key}>{key === "email" ? t("publicEmail") : "Web Push"}</option>)}</NativeSelect></div>{management && <><p>{t(management.active ? "publicActive" : "publicInactive")}</p><div className="monitor-actions"><button className="btn btn-ghost" type="button" disabled={busy} onClick={()=>void update(false)}>{t("publicSavePreferences")}</button><button className="btn btn-ghost" type="button" disabled={busy} onClick={()=>void update(true)}>{t("publicUnsubscribe")}</button></div><p className="event-boundary">{t("publicDeliveryBoundary")}</p>{management.deliveries.map((row,index)=><p key={index}>{t("publicDelivery_"+row.state)} · {row.attempts} · {row.updated_at}</p>)}</>}</div>}
    </>}
    {message && <p role="status">{t(message)}</p>}
    <details className="public-mcp"><summary>{t("publicDeveloper")}</summary><p>{t("publicMCPHint")}</p><code>{location.origin}/mcp</code><button className="btn btn-ghost" type="button" onClick={()=>void navigator.clipboard.writeText(location.origin+"/mcp").then(()=>toast(t("personalCopied"),true)).catch(()=>toast(t("personalCopyFail"),false))}>{t("publicCopyMCP")}</button><pre>{JSON.stringify({mcpServers:{resetMonitor:{url:location.origin+"/mcp"}}},null,2)}</pre></details>
  </details></section>;
}
