/* 后端 API 访问：/api/* 统一 {code, data, message} 包体。
   已登录（本地存有 JWT）时自动携带 Authorization: Bearer；401 错误带 auth 标记，
   供调用方触发登录弹窗后重试。 */

export const TOKEN_KEY = "crm-jwt";
export const USER_KEY = "crm-jwt-user";

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function saveSession(token: string, user: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, user);
  } catch {
    /* 隐私模式等场景下写入失败：会话不持久，功能仍可用 */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* 同上 */
  }
}

export function getStoredUser(): string {
  try {
    return localStorage.getItem(USER_KEY) || "";
  } catch {
    return "";
  }
}

export class ApiError extends Error {
  auth: boolean;
  constructor(message: string, auth: boolean) {
    super(message);
    this.auth = auth;
  }
}

export async function j<T = unknown>(url: string, opt: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  Object.assign(headers, (opt.headers as Record<string, string>) || {});
  const tok = getToken();
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  const r = await fetch(url, { ...opt, headers });
  let body: { code?: number; data?: T; message?: string } | null = null;
  try {
    body = await r.json();
  } catch {
    body = null;
  }
  if (!r.ok || !body || body.code !== 200) {
    throw new ApiError((body && body.message) || `HTTP ${r.status}`, body?.code === 401);
  }
  return body.data as T;
}
