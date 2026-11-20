import { useEffect, useRef, useState } from "react";
import { ensure, wsUrl } from "./api";

export interface StreamMsg {
  kind: "telemetry" | "event";
  // telemetry
  node?: string; phase?: string; level?: "info" | "warn" | "error"; detail?: Record<string, any>; at?: string;
  // event
  event_id?: string; seq?: number; type?: string; occurred_at?: string; payload?: Record<string, any>; correlation_id?: string;
  txn_ref?: string | null;
}

export function msgRef(m: StreamMsg): string | undefined {
  return (m.txn_ref || m.payload?.txn_ref || undefined) as string | undefined;
}

/** Live WebSocket feed with automatic reconnect. `as` decides what the server lets this screen see. */
export function useStream(as: string | null, onMsg: (m: StreamMsg) => void) {
  const [connected, setConnected] = useState(false);
  const cb = useRef(onMsg);
  cb.current = onMsg;
  useEffect(() => {
    if (!as) return;
    let ws: WebSocket | null = null;
    let stop = false;
    let retry = 0;
    let timer: number | undefined;
    const open = async () => {
      try {
        const s = await ensure(as);
        ws = new WebSocket(wsUrl(s.token));
        ws.onopen = () => { retry = 0; setConnected(true); };
        ws.onmessage = (e) => { try { cb.current(JSON.parse(e.data)); } catch { /* ignore */ } };
        ws.onclose = () => { setConnected(false); if (!stop) timer = window.setTimeout(open, Math.min(8000, 500 * 2 ** retry++)); };
        ws.onerror = () => ws?.close();
      } catch {
        if (!stop) timer = window.setTimeout(open, 3000);
      }
    };
    open();
    return () => { stop = true; window.clearTimeout(timer); ws?.close(); };
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
