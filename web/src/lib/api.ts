// Thin, typed client for the Rupay API. Payment status always comes from the server - never invented here.

const KEY_BASE = "paya.apiBase";
const KEY_SESSIONS = "paya.sessions";

function safeGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* private mode: in-memory only */ }
}

export function apiBase(): string {
  // Precedence: this device's setting, then the build's VITE_API_URL, then: in development the local API, and in a
  // production build the page's own origin (on Vercel the API is a service behind /v1 on the same domain).
  const fallback = import.meta.env.DEV ? "http://localhost:8000" : window.location.origin;
  return (safeGet(KEY_BASE) || import.meta.env.VITE_API_URL || fallback).replace(/\/$/, "");
}
export function setApiBase(url: string) { safeSet(KEY_BASE, url.trim().replace(/\/$/, "")); }

/** A link like https://<vercel-app>/app?api=https://<backend> points this device at that backend. Needed on iPhone:
 *  a Home Screen app has its own storage, separate from Safari, so the address must reach it via its own link/QR
 *  or the setting on the sign-in screen. Only http(s) URLs are accepted; the parameter is removed after use. */
export function adoptApiFromUrl() {
  try {
    const u = new URL(window.location.href);
    const api = u.searchParams.get("api");
    if (!api) return;
    const parsed = new URL(api);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") setApiBase(parsed.origin);
    u.searchParams.delete("api");
    window.history.replaceState(null, "", u.pathname + (u.search ? u.search : "") + u.hash);
  } catch { /* ignore a malformed link */ }
}

/** A page served over HTTPS cannot call an http:// backend (the browser blocks it); localhost is the exception. */
export function mixedContent(base = apiBase()): boolean {
  try {
    const b = new URL(base);
    return window.location.protocol === "https:" && b.protocol === "http:" && !["localhost", "127.0.0.1"].includes(b.hostname);
  } catch { return false; }
}

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

// ---- MFA and revocation (ADR-017) ----------------------------------------------------------------
// A staff sign-in may need a second factor. The screen that can ask for it registers a handler; without
// one (the customer wallet) such a sign-in fails with MFA_REQUIRED.
export interface MfaChallenge { username: string; kind: "mfa" | "setup"; challenge: string }
type MfaHandler = (c: MfaChallenge) => Promise<Session>;
let mfaHandler: MfaHandler | null = null;
export function setMfaHandler(fn: MfaHandler | null) { mfaHandler = fn; }

// A session ended by sign-out elsewhere, an administrator or an MFA change must NOT be silently re-opened
// with the demo password: the user signs in again explicitly.
const endedReason: Record<string, string> = {};
type EndedListener = (username: string, reason: string) => void;
const endedListeners = new Set<EndedListener>();
export function onSessionEnded(fn: EndedListener) { endedListeners.add(fn); return () => { endedListeners.delete(fn); }; }

function store(username: string, body: any): Session {
  const s: Session = { username, token: body.access_token, role: body.role, display_name: body.display_name,
    customer_id: body.customer_id || undefined, merchant_id: body.merchant_id || undefined };
  memSessions = { ...memSessions, [username]: s };
  saveSessions();
  delete endedReason[username];
  return s;
}

async function post(path: string, payload: unknown): Promise<any> {
  const r = await fetch(`${apiBase()}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, body?.error?.code || "ERROR", body?.error?.message || r.statusText, body);
  return body;
}

export async function login(username: string, password = DEMO_PASSWORD): Promise<Session> {
  const body = await post("/v1/auth/login", { username, password }).catch((e: ApiError) => {
    throw e.code === "ERROR" ? new ApiError(e.status, "LOGIN_FAILED", "Login failed") : e;
  });
  if (body.mfa_required || body.mfa_setup_required) {
    const c: MfaChallenge = { username, kind: body.mfa_required ? "mfa" : "setup", challenge: body.challenge };
    if (!mfaHandler) throw new ApiError(401, "MFA_REQUIRED", "This account needs a verification code. Use Mission Control.");
    return mfaHandler(c);
  }
  return store(username, body);
}

export async function verifyMfa(username: string, challenge: string, code: string): Promise<Session> {
  return store(username, await post("/v1/auth/mfa/verify", { challenge, code }));
}
export async function startMfaSetup(challenge: string): Promise<{ secret: string; otpauth_uri: string }> {
  return post("/v1/auth/mfa/setup", { challenge });
}
export async function confirmMfaSetup(username: string, challenge: string, code: string): Promise<Session> {
  return store(username, await post("/v1/auth/mfa/setup/confirm", { challenge, code }));
}

/** Sign out on the server (the token stops working everywhere at once), then forget it here. */
export async function logout(username: string) {
  const s = memSessions[username];
  if (s) await fetch(`${apiBase()}/v1/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${s.token}` } }).catch(() => {});
  forget(username);
}

export async function ensure(username: string): Promise<Session> {
  if (memSessions[username]) return memSessions[username];
  if (endedReason[username]) throw new ApiError(401, "SESSION_ENDED", `Your session was ended (${endedReason[username]}). Sign in again.`);
  return login(username);
}

export async function call<T = any>(as: string, path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<{ data: T; headers: Headers; status: number }> {
  const s = await ensure(as);
  const headers: Record<string, string> = { authorization: `Bearer ${s.token}`, ...(init.headers as any) };
  if (init.body) headers["content-type"] = "application/json";
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
  const r = await fetch(`${apiBase()}${path}`, { cache: "no-store", ...init, headers });
  const body = await r.json().catch(() => ({}));
  if (r.status === 401) {
    forget(as);
    const reason = body?.error?.reason;
    if (reason) { endedReason[as] = reason; endedListeners.forEach((fn) => fn(as, reason)); }
  }
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
