// Mission Control core: who is operating (a real signed-in staff member), what they may do (from the server's
// permission list), and one shared, de-duplicated live stream for every page.
import { useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { EmptyState } from "../ds/ui";
import { call, ensure, wsUrl } from "../lib/api";
import type { StreamMsg } from "../lib/stream";

// ------------------------------------------------------------------ operator
export const STAFF = [
  { username: "sana.ops", name: "Sana", role: "OPS", title: "Operations" },
  { username: "faisal.ops", name: "Faisal", role: "OPS", title: "Operations" },
  { username: "hamza.compliance", name: "Hamza", role: "COMPLIANCE", title: "Compliance" },
  { username: "nadia.compliance", name: "Nadia", role: "COMPLIANCE", title: "Compliance (2nd officer)" },
  { username: "rabia.finance", name: "Rabia", role: "FINANCE", title: "Finance & reconciliation" },
  { username: "admin", name: "Admin", role: "SYSADMIN", title: "System administrator" },
  { username: "auditor", name: "Auditor", role: "AUDITOR", title: "Internal audit (read-only)" },
];

export interface Operator { username: string; role: string; display_name: string; permissions: string[] }
const OpCtx = createContext<{ op: Operator; switchTo: (u: string) => Promise<void>; signOut: () => void } | null>(null);
export const OP_KEY = "paya.operator";

export function useOperator() {
  const c = useContext(OpCtx);
  if (!c) throw new Error("useOperator outside console");
  return c;
}
export function useCan() {
  const { op } = useOperator();
  return useCallback((perm: string) => op.permissions.includes(perm), [op]);
}

export async function loadOperator(username: string): Promise<Operator> {
  await ensure(username);
  const me = (await call<any>(username, "/v1/me")).data;
  const staff = STAFF.find((s) => s.username === username);
  return { username, role: me.role, permissions: me.permissions, display_name: staff ? `${staff.name} · ${staff.title}` : username };
}

export function OperatorProvider({ op, setOp, children }: { op: Operator; setOp: (o: Operator | null) => void; children: ReactNode }) {
  const qc = useQueryClient();
  const value = useMemo(() => ({
    op,
    switchTo: async (u: string) => { const next = await loadOperator(u); try { localStorage.setItem(OP_KEY, u); } catch { /* */ } qc.clear(); setOp(next); },
    signOut: () => { try { localStorage.removeItem(OP_KEY); } catch { /* */ } qc.clear(); setOp(null); },
  }), [op, setOp, qc]);
  return <OpCtx.Provider value={value}>{children}</OpCtx.Provider>;
}

// ------------------------------------------------------------------ live stream
export interface LiveMsg extends StreamMsg { _id: string; _rx: number }
interface StreamState { connected: boolean; reconnecting: boolean; messages: LiveMsg[]; paused: boolean; setPaused: (p: boolean) => void; lastAt: number | null; subscribe: (fn: (m: LiveMsg) => void) => () => void }
const StreamCtx = createContext<StreamState | null>(null);
export const useLive = () => useContext(StreamCtx)!;

/** One WebSocket per console. De-duplicates by event_id (events can be delivered more than once by design). */
export function StreamProvider({ as, children }: { as: string; children: ReactNode }) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [messages, setMessages] = useState<LiveMsg[]>([]);
  const [paused, setPaused] = useState(false);
  const [lastAt, setLastAt] = useState<number | null>(null);
  const seen = useRef(new Set<string>());
  const subs = useRef(new Set<(m: LiveMsg) => void>());
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const held = useRef<LiveMsg[]>([]);
  const inval = useRef<number | undefined>();

  useEffect(() => {
    let ws: WebSocket | null = null, stop = false, retry = 0, timer: number | undefined;
    const open = async () => {
      try {
        const s = await ensure(as);
        ws = new WebSocket(wsUrl(s.token));
        ws.onopen = () => { retry = 0; setConnected(true); setReconnecting(false); };
        ws.onmessage = (e) => {
          let m: StreamMsg; try { m = JSON.parse(e.data); } catch { return; }
          const id = m.kind === "event" ? `e:${m.event_id}` : `t:${m.node}:${m.phase}:${m.at}:${m.txn_ref || ""}:${JSON.stringify(m.detail || {}).length}`;
          if (seen.current.has(id)) return;
          seen.current.add(id);
          if (seen.current.size > 5000) seen.current = new Set(Array.from(seen.current).slice(-2500));
          const lm: LiveMsg = { ...m, _id: id, _rx: Date.now() };
          setLastAt(Date.now());
          subs.current.forEach((fn) => fn(lm));
          if (pausedRef.current) held.current.push(lm);
          else setMessages((cur) => [lm, ...cur].slice(0, 600));
          if (m.kind === "event" || m.node === "human_gate" || m.node === "kyc") {
            window.clearTimeout(inval.current);
            inval.current = window.setTimeout(() => qc.invalidateQueries(), 600); // refresh read models after facts change
          }
        };
        ws.onclose = () => { setConnected(false); if (!stop) { setReconnecting(true); timer = window.setTimeout(open, Math.min(8000, 500 * 2 ** retry++)); } };
        ws.onerror = () => ws?.close();
      } catch { if (!stop) { setReconnecting(true); timer = window.setTimeout(open, 3000); } }
    };
    open();
    return () => { stop = true; window.clearTimeout(timer); ws?.close(); };
  }, [as, qc]);

  useEffect(() => {
    if (!paused && held.current.length) { const h = held.current.reverse(); held.current = []; setMessages((cur) => [...h, ...cur].slice(0, 600)); }
  }, [paused]);

  const subscribe = useCallback((fn: (m: LiveMsg) => void) => { subs.current.add(fn); return () => { subs.current.delete(fn); }; }, []);
  return <StreamCtx.Provider value={{ connected, reconnecting, messages, paused, setPaused, lastAt, subscribe }}>{children}</StreamCtx.Provider>;
}

// ------------------------------------------------------------------ page frame & guards
export function Page({ title, description, actions, children, wide }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => { document.title = `${title} · Paya Mission Control`; }, [title]);
  return (
    <div className={wide ? "px-6 py-5" : "mx-auto max-w-[1440px] px-6 py-5"}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-title-1 text-fg">{title}</h1>
          {description && <p className="mt-0.5 max-w-3xl text-body-sm text-fg-2">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Restricted({ perm, children }: { perm: string | string[]; children: ReactNode }) {
  const can = useCan();
  const { op } = useOperator();
  const ok = (Array.isArray(perm) ? perm : [perm]).some(can);
  if (ok) return <>{children}</>;
  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <EmptyState icon={<Lock className="h-5 w-5" />} title="Not available for your role"
        body={<>Signed in as <b>{op.display_name}</b> ({op.role}). This area needs <code className="ref">{Array.isArray(perm) ? perm.join(" or ") : perm}</code>. The server enforces this; switch operator from the top bar if you hold another role.</>} />
    </div>
  );
}

/** Open the transaction or case inspector from anywhere via the URL (?txn=REF or ?case=REF), so links are shareable. */
export function useInspector() {
  const [params, setParams] = useSearchParams();
  return {
    txn: params.get("txn"), case: params.get("case"), app: params.get("app"),
    openTxn: (ref: string) => setParams((p) => { p.set("txn", ref); p.delete("case"); p.delete("app"); return p; }),
    openCase: (ref: string) => setParams((p) => { p.set("case", ref); p.delete("txn"); p.delete("app"); return p; }),
    openApp: (ref: string) => setParams((p) => { p.set("app", ref); p.delete("txn"); p.delete("case"); return p; }),
    close: () => setParams((p) => { p.delete("txn"); p.delete("case"); p.delete("app"); return p; }),
  };
}

export function useOpApi() {
  const { op } = useOperator();
  return op.username;
}
