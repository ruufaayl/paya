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
export function startLivePoll(as: string, onMsg: (m: StreamMsg) => void, onStatus?: (ok: boolean) => void, everyMs = 1000): () => void {
  let stop = false, timer: number | undefined, fails = 0;
  let cur: { event: number; tel: number } | null = null;
  const tick = async () => {
    try {
      const q = cur ? `?after_event=${cur.event}&after_tel=${cur.tel}` : "";
      const r = (await call<{ messages: StreamMsg[]; cursor: { event: number; tel: number } }>(as, `/v1/live${q}`)).data;
      if (cur) r.messages.forEach((m) => onMsg(m));
      cur = r.cursor;
      fails = 0; onStatus?.(true);
    } catch { if (++fails >= 3) onStatus?.(false); /* one slow request (cold start) is not "offline" */ }
    if (!stop) timer = window.setTimeout(tick, document.hidden ? everyMs * 4 : everyMs);
  };
  tick();
  return () => { stop = true; window.clearTimeout(timer); };
}

/** One live link: the database poller (sees every server instance) plus a WebSocket where the host supports it.
 *  Connected = either is healthy. On serverless hosts the socket cannot stay open; after a few failed opens we stop
 *  retrying it (and try again every minute) instead of flapping the status. */
export function liveLink(as: string, deliver: (m: StreamMsg) => void, onState: (s: { connected: boolean; reconnecting: boolean }) => void): () => void {
  let pollOk = false, wsOk = false, stop = false, retry = 0, closedWithoutOpen = 0;
  let ws: WebSocket | null = null, timer: number | undefined;
  const emit = () => onState({ connected: pollOk || wsOk, reconnecting: !(pollOk || wsOk) });
  const stopPoll = startLivePoll(as, deliver, (ok) => { if (ok !== pollOk) { pollOk = ok; emit(); } });
  const open = async () => {
    let opened = false;
    try {
      const s = await ensure(as);
      ws = new WebSocket(wsUrl(s.token));
      ws.onopen = () => { opened = true; retry = 0; closedWithoutOpen = 0; wsOk = true; emit(); };
      ws.onmessage = (e) => { try { deliver(JSON.parse(e.data)); } catch { /* ignore */ } };
      ws.onclose = () => {
        wsOk = false; emit();
        if (stop) return;
        if (!opened) closedWithoutOpen++;
        const giveUp = closedWithoutOpen >= 3;            // host can't hold sockets: rely on the poller
        timer = window.setTimeout(open, giveUp ? 60_000 : Math.min(8000, 500 * 2 ** retry++));
      };
      ws.onerror = () => ws?.close();
    } catch { if (!stop) timer = window.setTimeout(open, 5000); }
  };
  open();
  return () => { stop = true; stopPoll(); window.clearTimeout(timer); if (ws) { ws.onclose = null; ws.close(); } };
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
    const link = liveLink(as, deliver, (s) => setConnected(s.connected));
    return link;
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
