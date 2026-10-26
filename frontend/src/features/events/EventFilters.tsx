/* 两处筛选共用同一组服务端参数，不在已经加载的页面上假筛选。 */
import { NativeSelect } from "../../components/NativeSelect";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { EventFilter } from "../../api/types";

export function EventFilters({ value, onChange, accounts, label }: {
  value: EventFilter; onChange: (next: EventFilter) => void; accounts: string[]; label: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  return <fieldset className="event-filters"><legend className="sr-only">{label}</legend>
    <div className="select-field"><label htmlFor={id + "-kind"}>{t("eventFilterKind")}</label><NativeSelect aria-label={t("eventFilterKind")} id={id + "-kind"} value={value.kind} onChange={e => onChange({ ...value, kind: e.target.value as EventFilter["kind"] })}>
      <option value="">{t("eventAllKinds")}</option>{["quota", "card", "other"].map(kind => <option key={kind} value={kind}>{t("eventKind_" + kind)}</option>)}
    </NativeSelect></div>
    <div className="select-field"><label htmlFor={id + "-phase"}>{t("eventFilterPhase")}</label><NativeSelect aria-label={t("eventFilterPhase")} id={id + "-phase"} value={value.phase} onChange={e => onChange({ ...value, phase: e.target.value as EventFilter["phase"] })}>
      <option value="">{t("eventAllPhases")}</option>{["completed", "scheduled", "unknown"].map(phase => <option key={phase} value={phase}>{t("eventPhase_" + phase)}</option>)}
    </NativeSelect></div>
    {accounts.length > 1 && <div className="select-field"><label htmlFor={id + "-account"}>{t("eventAccount")}</label><NativeSelect aria-label={t("eventAccount")} id={id + "-account"} value={value.account} onChange={e => onChange({ ...value, account: e.target.value })}>
      <option value="">{t("eventAllAccounts")}</option>{accounts.map(account => <option key={account} value={account}>@{account}</option>)}
    </NativeSelect></div>}
  </fieldset>;
}
