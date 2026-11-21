// Thin, typed client for the Paya API. Payment status always comes from the server - never invented here.

const KEY_BASE = "paya.apiBase";
const KEY_SESSIONS = "paya.sessions";

function safeGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* private mode: in-memory only */ }
}

export function apiBase(): string {
  return (safeGet(KEY_BASE) || import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");
}
export function setApiBase(url: string) { safeSet(KEY_BASE, url.trim().replace(/\/$/, "")); }

export type Role = "CUSTOMER" | "CASHIER" | "MERCHANT_ADMIN" | "OPS" | "COMPLIANCE" | "FINANCE" | "SYSADMIN" | "AUDITOR";
export interface Session { username: string; token: string; role: Role; display_name: string; customer_id?: string; merchant_id?: string; }

let memSessions: Record<string, Session> = (() => {
  try { return JSON.parse(safeGet(KEY_SESSIONS) || "{}"); } catch { return {}; }
})();

export function sessions(): Record<string, Session> { return memSessions; }
export function session(username: string): Session | undefined { return memSessions[username]; }
function saveSessions() { safeSet(KEY_SESSIONS, JSON.stringify(memSessions)); }
export function forget(username: string) { delete memSessions[username]; saveSessions(); }

export const DEMO_PASSWORD = "paya-demo-2026";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public body?: any) { super(message); }
}

export async function login(username: string, password = DEMO_PASSWORD): Promise<Session> {
  const r = await fetch(`${apiBase()}/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, body?.error?.code || "LOGIN_FAILED", body?.error?.message || "Login failed");
  const s: Session = { username, token: body.access_token, role: body.role, display_name: body.display_name,
    customer_id: body.customer_id || undefined, merchant_id: body.merchant_id || undefined };
  memSessions = { ...memSessions, [username]: s };
  saveSessions();
  return s;
}

export async function ensure(username: string): Promise<Session> {
  return memSessions[username] || login(username);
}

export async function call<T = any>(as: string, path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<{ data: T; headers: Headers; status: number }> {
  const s = await ensure(as);
  const headers: Record<string, string> = { authorization: `Bearer ${s.token}`, ...(init.headers as any) };
  if (init.body) headers["content-type"] = "application/json";
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
  const r = await fetch(`${apiBase()}${path}`, { ...init, headers });
  if (r.status === 401) { forget(as); }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, body?.error?.code || "ERROR", body?.error?.message || r.statusText, body);
  return { data: body as T, headers: r.headers, status: r.status };
}

export const newIdempotencyKey = () => `paya-${crypto.randomUUID()}`;

export function wsUrl(token: string): string {
  return `${apiBase().replace(/^http/, "ws")}/v1/stream?token=${encodeURIComponent(token)}`;
}

export const pkr = (minor: number) => `Rs ${(minor / 100).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Onboarding calls use a short-lived applicant token held in memory only (never in storage). */
export async function onboard<T = any>(path: string, token: string | null, body?: unknown, method = "POST"): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(`${apiBase()}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = Array.isArray(data?.detail) ? data.detail.map((d: any) => d.msg).join("; ") : undefined;
    throw new ApiError(r.status, data?.error?.code || "ERROR", data?.error?.message || detail || r.statusText, data);
  }
  return data as T;
}
