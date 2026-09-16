/* 后端出参类型：与 app/schemas/*.py 保持一致。 */

export interface Tweet {
  id: string;
  account: string;
  text: string;
  url: string;
  created_at: string;
  source: string;
  matched: boolean;
  rule_name?: string | null;
  matched_terms: string[];
  notified: boolean;
  is_reply?: boolean | null;
  /* 账号昵称/头像（按账号缓存，未命中为空）：头像走 safeUrl，缺失时前端字母头像兜底 */
  author_name?: string | null;
  author_avatar?: string | null;
}

export interface SourceState {
  name: string;
  enabled: boolean;
  configured: boolean;
  known: boolean;
  healthy: boolean;
  failures: number;
  last_ok?: string | null;
  last_error?: string | null;
}

export interface NotifierState {
  name: string;
  enabled: boolean;
  configured: boolean;
}

export interface RuleInfo {
  name?: string | null;
  patterns: string[];
}

export interface Status {
  demo: boolean;
  debug: boolean;
  access_protected: boolean;
  env_mode: string;
  site_name?: string | null;
  config_file?: string | null;
  accounts: string[];
  poll_interval_minutes: number;
  lookback_hours: number;
  last_poll_at?: string | null;
  tweets_24h: number;
  hit_count_24h: number;
  latest_hit?: Tweet | null;
  hits: Tweet[];
  sources: SourceState[];
  notifiers: NotifierState[];
  rules: RuleInfo[];
}

export interface Stats {
  total_hits: number;
  hits_30d: number;
  avg_interval_hours?: number | null;
  last_hit_at?: string | null;
  next_expected_at?: string | null;
  since?: string | null;
  recent_hits: string[];
  daily_hits: { day: string; count: number }[];
}

export interface Poll {
  id: number;
  ts?: string | null;
  account?: string | null;
  source?: string | null;
  ok?: number | null;
  new_tweets?: number | null;
  error?: string | null;
  latency_ms?: number | null;
}

export interface LoginOut {
  access_token: string;
  token_type: string;
  expires_at: string;
}
