/* 只提取白名单用量字段，原始状态文本与可能夹带的凭证不持久化、不上传。 */
export interface PersonalQuota {
  version: 1; primaryUsed: number | null; secondaryUsed: number | null;
  primaryReset: string | null; secondaryReset: string | null; cardExpiry: string | null; updatedAt: string;
}
export function percent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}
export function exactTime(value: unknown): string | null {
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T/);
    if (!match) return null;
    const [year, month, day] = match.slice(1).map(Number);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) return null;
  }
  const raw = typeof value === "number" ? value * 1000 : typeof value === "string" && /T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : NaN;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 2000 && date.getUTCFullYear() <= 2200 ? date.toISOString() : null;
}
export function personalRecord(input: unknown): PersonalQuota | null {
  if (!input || typeof input !== "object") return null;
  const data = input as Record<string, unknown>;
  if (data.version !== 1 || !exactTime(data.updatedAt)) return null;
  return { version: 1, primaryUsed: percent(data.primaryUsed), secondaryUsed: percent(data.secondaryUsed), primaryReset: exactTime(data.primaryReset), secondaryReset: exactTime(data.secondaryReset), cardExpiry: exactTime(data.cardExpiry), updatedAt: exactTime(data.updatedAt)! };
}
export function parseStatus(raw: string): Partial<PersonalQuota> | null {
  if (raw.length > 50000) return null;
  const result: Partial<PersonalQuota> = {};
  try {
    const parsed = JSON.parse(raw);
    const data = parsed?.rate_limits?.codex || parsed?.rate_limit || parsed?.rate_limits || parsed;
    for (const [key, field] of [["primary_window", "primary"], ["secondary_window", "secondary"]] as const) {
      const window = data?.[key];
      const used = percent(window?.used_percent), reset = exactTime(window?.reset_at);
      if (used != null) result[field === "primary" ? "primaryUsed" : "secondaryUsed"] = used;
      if (reset) result[field === "primary" ? "primaryReset" : "secondaryReset"] = reset;
    }
  } catch { /* 非 JSON 文本仅接受明确字段与带时区的 ISO 时间。 */ }
  if (!Object.keys(result).length) {
    for (const line of raw.split(/\r?\n/)) {
      const field = /5\s*h|5\s*小时|primary/i.test(line) ? "primary" : /week|7\s*d|周|secondary/i.test(line) ? "secondary" : null;
      if (!field) continue;
      const match = line.match(/(\d+(?:\.\d+)?)\s*%\s*(left|remaining|used|剩余|已用)/i) || line.match(/(剩余|已用)\s*(\d+(?:\.\d+)?)\s*%/);
      if (match) {
        const number = Number(/\d/.test(match[1]) ? match[1] : match[2]);
        const usage = percent(/left|remaining|剩余/i.test(match[0]) ? 100 - number : number);
        if (usage != null) result[field === "primary" ? "primaryUsed" : "secondaryUsed"] = usage;
      }
      const iso = line.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})/i)?.[0];
      const reset = exactTime(iso);
      if (reset) result[field === "primary" ? "primaryReset" : "secondaryReset"] = reset;
    }
  }
  return Object.keys(result).length ? result : null;
}
