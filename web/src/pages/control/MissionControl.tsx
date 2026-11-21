import { Background, BackgroundVariant, type Edge, type Node, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, CircleCheck, CircleX, Gauge, Hand, Landmark, Radio, Scale, ShieldAlert, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../../components/ui";
import { call, pkr } from "../../lib/api";
import { type StreamMsg, useStream } from "../../lib/stream";
import { COLORS, EDGES, effectOf, NODES, type NodeState, type Packet, PacketEdge, ServiceNode } from "./graph";
import { ChaosPanel, FeedPanel, GatesPanel, Inspector, type Toast } from "./panels";

const nodeTypes = { service: ServiceNode };
const edgeTypes = { packet: PacketEdge };

interface Summary {
  payments_by_status: Record<string, number>; success_rate: number; pending: number; in_transit: { minor: number };
  open_cases: Record<string, number>; rail: { breaker: string; mode: string }; ledger_balanced: boolean;
}

export default function MissionControl() {
  return <ReactFlowProvider><Control /></ReactFlowProvider>;
}

function Control() {
  const [states, setStates] = useState<Record<string, NodeState>>(() => Object.fromEntries(NODES.map((n) => [n.id, { level: "idle", count: 0 }])));
  const [packets, setPackets] = useState<Record<string, Packet[]>>({});
  const [hot, setHot] = useState<Record<string, string>>({});
  const [feed, setFeed] = useState<StreamMsg[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tab, setTab] = useState<"gates" | "feed">("gates");
  const [inspect, setInspect] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [focus, setFocus] = useState(false)
  const [toasts, setToasts] = useState<{ id: number; text: string; tone: string }[]>([]);
  const seq = useRef(0);
  const decay = useRef<Record<string, number>>({});

  const toast: Toast = useCallback((text, tone = "ok") => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const loadSummary = useCallback(() => call<Summary>("auditor", "/v1/metrics/summary").then((r) => setSummary(r.data)).catch(() => undefined), []);
  useEffect(() => { loadSummary(); const t = setInterval(loadSummary, 2500); return () => clearInterval(t); }, [loadSummary]);

  const onMsg = useCallback((m: StreamMsg) => {
    setFeed((f) => [m, ...f].slice(0, 160));
    const fx = effectOf(m);
    if (fx.hops.length) {
      const id = `p${++seq.current}`;
      setPackets((cur) => {
        const next = { ...cur };
        fx.hops.forEach((h, i) => { next[h.edge] = [...(next[h.edge] || []), { id: `${id}-${i}`, color: h.color, reverse: h.reverse }]; });
        return next;
      });
      setHot((cur) => ({ ...cur, ...Object.fromEntries(fx.hops.map((h) => [h.edge, h.color])) }));
      setTimeout(() => {
        setPackets((cur) => {
          const next = { ...cur };
          fx.hops.forEach((h, i) => { next[h.edge] = (next[h.edge] || []).filter((p) => p.id !== `${id}-${i}`); });
          return next;
        });
      }, 1100);
      setTimeout(() => setHot((cur) => {
        const next = { ...cur };
        fx.hops.forEach((h) => { if (next[h.edge] === h.color) delete next[h.edge]; });
        return next;
      }), 1600);
    }
    if (fx.nodes.length) {
      setStates((cur) => {
        const next = { ...cur };
        fx.nodes.forEach((n) => { next[n.id] = { ...next[n.id], level: n.level, last: n.text, count: next[n.id].count + 1, pulseKey: ++seq.current }; });
        return next;
      });
      fx.nodes.forEach((n) => {
        window.clearTimeout(decay.current[n.id]);
        if (n.level !== "human") decay.current[n.id] = window.setTimeout(() =>
          setStates((cur) => ({ ...cur, [n.id]: { ...cur[n.id], level: "idle" } })), n.level === "error" ? 5000 : 2200);
      });
    }
    if (m.kind === "event" || m.node === "human_gate" || m.node === "chaos" || m.node === "ai") setTick((t) => t + 1);
  }, []);
  const connected = useStream("auditor", onMsg);

  // Human-gate badges come from the live case count, not from animation state.
  useEffect(() => {
    if (!summary) return;
    const oc = summary.open_cases || {};
    setStates((cur) => ({
      ...cur,
      compliance: { ...cur.compliance, badge: oc.COMPLIANCE_HOLD || 0, level: (oc.COMPLIANCE_HOLD || 0) > 0 ? "human" : cur.compliance.level === "human" ? "idle" : cur.compliance.level },
      ops: { ...cur.ops, badge: (oc.PENDING_REVIEW || 0) + (oc.RECON_BREAK || 0), level: ((oc.PENDING_REVIEW || 0) + (oc.RECON_BREAK || 0)) > 0 ? "human" : cur.ops.level === "human" ? "idle" : cur.ops.level },
      rail: summary.rail.breaker !== "CLOSED" ? { ...cur.rail, level: "error", last: `circuit ${summary.rail.breaker}` } : cur.rail,
    }));
  }, [summary]);

  const nodes: Node[] = useMemo(() => NODES.map((n) => ({
    id: n.id, type: "service", position: { x: n.x, y: n.y }, draggable: true, data: { def: n, state: states[n.id] } as any,
  })), [states]);
  const edges: Edge[] = useMemo(() => EDGES.map((e) => ({
    id: e.id, source: e.source, target: e.target, type: "packet",
    sourceHandle: `s-${e.sh || "r"}`, targetHandle: `t-${e.th || "l"}`,
    data: { packets: packets[e.id] || [], dashed: e.dashed, hot: hot[e.id] } as any,
  })), [packets, hot]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "f" && !(e.target instanceof HTMLInputElement)) setFocus((v) => !v); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, []);

  const humanCount = summary ? Object.values(summary.open_cases || {}).reduce((a, b) => a + b, 0) : 0;
  return (
    <div className="flex h-full flex-col bg-ink-950 text-slate-100">
      <header className="flex items-center gap-4 border-b border-white/5 px-5 py-3">
        <Link to="/"><Logo size={26} /></Link>
        <span className="text-sm font-semibold text-slate-300">Mission Control</span>
        <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${connected ? "text-paya-300 ring-paya-500/40" : "text-rose-300 ring-rose-500/40"}`}>
          <Radio size={12} className={connected ? "animate-pulse" : ""} /> {connected ? "LIVE" : "reconnecting"}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Metric icon={Gauge} label="Success" value={summary ? `${Math.round(summary.success_rate * 100)}%` : "-"} />
          <Metric icon={Activity} label="In flight" value={summary ? String(summary.pending) : "-"} tone={summary && summary.pending > 0 ? "warn" : undefined} />
          <Metric icon={Landmark} label="In transit" value={summary ? pkr(summary.in_transit.minor) : "-"} />
          <Metric icon={Hand} label="Need a human" value={String(humanCount)} tone={humanCount ? "human" : undefined} />
          <Metric icon={Zap} label="Rail" value={summary ? `${summary.rail.mode} - ${summary.rail.breaker}` : "-"} tone={summary && (summary.rail.mode !== "NORMAL" || summary.rail.breaker !== "CLOSED") ? "error" : undefined} />
          <Metric icon={Scale} label="Ledger" value={summary ? (summary.ledger_balanced ? "balanced" : "UNBALANCED") : "-"} tone={summary && !summary.ledger_balanced ? "error" : "ok"} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className={`${focus ? "hidden" : ""} w-[264px] shrink-0 overflow-y-auto border-r border-white/5 p-4 scrollbar-thin`}>
          <ChaosPanel railMode={summary?.rail.mode || "NORMAL"} toast={toast} />
          <Legend />
        </aside>

        <main className="relative min-w-0 flex-1 grid-bg">
          <button onClick={() => setFocus((v) => !v)} className="absolute right-3 top-3 z-10 rounded-lg bg-ink-900/90 px-2.5 py-1.5 text-[11px] text-slate-400 ring-1 ring-white/10 hover:text-white">
            {focus ? "Show panels" : "Focus map"} <span className="ml-1 rounded bg-white/10 px-1 font-mono">F</span>
          </button>
          <ReactFlow key={focus ? "focus" : "panels"} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{ padding: 0.06 }}
            proOptions={{ hideAttribution: true }} minZoom={0.3} maxZoom={1.6} nodesConnectable={false} colorMode="dark">
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(255,255,255,0.05)" />
          </ReactFlow>
          <div className="pointer-events-none absolute bottom-4 left-4 flex flex-col gap-2">
            <AnimatePresence>
              {toasts.map((t) => (
                <motion.div key={t.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className={`pointer-events-auto flex max-w-md items-center gap-2 rounded-xl px-3 py-2 text-xs ring-1 backdrop-blur-xl ${t.tone === "ok" ? "bg-paya-500/15 text-paya-200 ring-paya-500/30" : t.tone === "warn" ? "bg-amber-400/15 text-amber-200 ring-amber-400/30" : "bg-rose-500/15 text-rose-200 ring-rose-500/30"}`}>
                  {t.tone === "ok" ? <CircleCheck size={14} /> : t.tone === "warn" ? <ShieldAlert size={14} /> : <CircleX size={14} />} {t.text}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </main>

        <aside className={`${focus ? "hidden" : ""} relative flex w-[350px] shrink-0 flex-col border-l border-white/5`}>
          <div className="flex gap-1 border-b border-white/5 p-2">
            {(["gates", "feed"] as const).map((k) => (
              <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-lg py-2 text-xs font-semibold ${tab === k ? "bg-white/10 text-white" : "text-slate-500"}`}>
                {k === "gates" ? `Human gates${humanCount ? ` (${humanCount})` : ""}` : `Live feed (${feed.length})`}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin">
            {tab === "gates" ? <GatesPanel tick={tick} toast={toast} onOpen={setInspect} /> : <FeedPanel feed={feed} onOpen={setInspect} />}
          </div>
          <AnimatePresence>{inspect && <Inspector txnRef={inspect} tick={tick} onClose={() => setInspect(null)} />}</AnimatePresence>
        </aside>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: "warn" | "error" | "human" | "ok" }) {
  const c = tone === "error" ? "text-rose-300 ring-rose-500/30" : tone === "warn" ? "text-amber-300 ring-amber-400/30" : tone === "human" ? "text-violet-300 ring-violet-400/40" : tone === "ok" ? "text-paya-300 ring-paya-500/25" : "text-slate-200 ring-white/10";
  return (
    <div className={`flex items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-1.5 ring-1 ${c}`}>
      <Icon size={14} className="opacity-70" />
      <span className="text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
      <span className="num text-xs font-semibold">{value}</span>
    </div>
  );
}

function Legend() {
  const item = (color: string, text: string) => (
    <div className="flex items-center gap-2 text-[11px] text-slate-400"><span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />{text}</div>
  );
  return (
    <div className="mt-6 space-y-1.5 rounded-2xl bg-white/[0.02] p-3 ring-1 ring-white/5">
      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Reading the map</h4>
      {item(COLORS.flow, "request / message in flight")}
      {item(COLORS.info, "confirmed fact (ledger, rail ack)")}
      {item(COLORS.warn, "uncertainty, retry, duplicate")}
      {item(COLORS.error, "failure, rejection, denial")}
      {item(COLORS.human, "waiting for a human decision")}
      <p className="pt-1 text-[10.5px] leading-relaxed text-slate-500">Every pulse is a real event from the Paya backend - nothing on this screen is scripted.</p>
    </div>
  );
}
