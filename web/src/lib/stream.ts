import { useEffect, useRef, useState } from "react";
import { call, ensure, wsUrl } from "./api";

export interface StreamMsg {
  kind: "telemetry" | "event";
  // telemetry
  node?: string; phase?: string; level?: "info" | "warn" | "error"; detail?: Record<string, any>; at?: string;
  // event
  event_id?: string; seq?: number; type?: string; occurred_at?: string; payload?: Record<string, any>; correlation_id?: string;
  txn_ref?: string | null;
  tseq?: number;   // telemetry persisted by the server (multi-instance deployments)
}

/** Stable identity for de-duplication: the same fact can arrive over the WebSocket and the poller. */
export function msgId(m: StreamMsg): string {
  if (m.kind === "event") return `e:${m.event_id}`;
  if (m.tseq) return `t:${m.tseq}`;
  return `t:${m.node}:${m.phase}:${m.at}:${m.txn_ref || ""}:${JSON.stringify(m.detail || {}).length}`;
}

/** Poll /v1/live (database-backed) every `everyMs`. On a deployment with several server instances (Vercel) the
 *  WebSocket only carries what its own instance saw; this carries everything. Returns a stop function. */
export function startLivePoll(as: string, onMsg: (m: StreamMsg) => void, everyMs = 1200): () => void {
  let stop = false, timer: number | undefined;
  let cur: { event: number; tel: number } | null = null;
  const tick = async () => {
    try {
      const q = cur ? `?after_event=${cur.event}&after_tel=${cur.tel}` : "";
      const r = (await call<{ messages: StreamMsg[]; cursor: { event: number; tel: number } }>(as, `/v1/live${q}`)).data;
      if (cur) r.messages.forEach((m) => onMsg(m));
      cur = r.cursor;
    } catch { /* offline or signed out: try again */ }
    if (!stop) timer = window.setTimeout(tick, document.hidden ? everyMs * 4 : everyMs);
  };
  tick();
  return () => { stop = true; window.clearTimeout(timer); };
}

export function msgRef(m: StreamMsg): string | undefined {
  return (m.txn_ref || m.payload?.txn_ref || undefined) as string | undefined;
}

/** Live WebSocket feed with automatic reconnect. `as` decides what the server lets this screen see. */
export function useStream(as: string | null, onMsg: (m: StreamMsg) => void) {
  const [connected, setConnected] = useState(false);
  const cb = useRef(onMsg);
  cb.current = onMsg;
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (!as) return;
    const deliver = (m: StreamMsg) => {
      const id = msgId(m);
      if (seen.current.has(id)) return;
      seen.current.add(id);
      if (seen.current.size > 3000) seen.current = new Set(Array.from(seen.current).slice(-1500));
      cb.current(m);
    };
    const stopPoll = startLivePoll(as, deliver);
    let ws: WebSocket | null = null;
    let stop = false;
    let retry = 0;
    let timer: number | undefined;
    const open = async () => {
      try {
        const s = await ensure(as);
        ws = new WebSocket(wsUrl(s.token));
        ws.onopen = () => { retry = 0; setConnected(true); };
        ws.onmessage = (e) => { try { deliver(JSON.parse(e.data)); } catch { /* ignore */ } };
        ws.onclose = () => { setConnected(false); if (!stop) timer = window.setTimeout(open, Math.min(8000, 500 * 2 ** retry++)); };
        ws.onerror = () => ws?.close();
      } catch {
        if (!stop) timer = window.setTimeout(open, 3000);
      }
    };
    open();
    return () => { stop = true; stopPoll(); window.clearTimeout(timer); ws?.close(); };
  }, [as]);
  return connected;
}

export function speak(text: string) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02; u.pitch = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch { /* not supported */ }
}
