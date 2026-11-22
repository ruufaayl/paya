// System topology: the real components of Paya and how messages move between them.
// Two kinds of information are kept apart on purpose:
//   ARCHITECTURE (static): what a node is, what it owns, where its code lives.
//   OBSERVED (runtime): telemetry this console actually received in the last 5 minutes.
// A node is never shown as "healthy" because of a colour. With no telemetry it says so.
import { BaseEdge, Background, BackgroundVariant, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, getBezierPath, useReactFlow,
  type Edge, type EdgeProps, type Node, type NodeChange, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AnimatePresence, motion } from "framer-motion";
import { Crosshair, Maximize2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Legend } from "../../ds/charts";
import { Badge, Button, Card, IconButton, SearchInput, cx } from "../../ds/ui";
import { ago } from "../../lib/hooks";
import { Page, Restricted, useLive, type LiveMsg } from "../core";
import { COLORS, EDGES, NODES, NODE_INFO, TELEMETRY_NODE, effectOf, type Layer, type Packet } from "../graph";

const LAYERS: { id: Layer; label: string }[] = [
  { id: "channel", label: "Channels" }, { id: "core", label: "Core services" }, { id: "store", label: "Systems of record" },
  { id: "agent", label: "Agents & workers" }, { id: "human", label: "Human gates" }, { id: "simulated", label: "Simulators" },
];
interface Observed { count: number; lastAt?: number; lastText?: string; lastLevel?: string; errors: number; lastErrorAt?: number }

export default function Topology() { return <Restricted perm="backoffice:read"><ReactFlowProvider><Inner /></ReactFlowProvider></Restricted>; }

function Inner() {
  const live = useLive();
  const rf = useReactFlow();
  const [observed, setObserved] = useState<Record<string, Observed>>({});
  const [packets, setPackets] = useState<Record<string, Packet[]>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  const [hidden, setHidden] = useState<Set<Layer>>(new Set());
  const [q, setQ] = useState("");
  // Settlements seen live (any user, any till): a ticker, a wave along the payment path and glowing components.
  const [settled, setSettled] = useState<{ id: string; ref: string; amount: number; merchant: string; at: number }[]>([]);
  const [totals, setTotals] = useState({ n: 0, minor: 0 });
  const [glow, setGlow] = useState<Record<string, number>>({});
  // React Flow 12 forgets a node's measured size when it receives a new node object and hides it until it is
  // re-measured, which never happens if the size did not change. Keep the measurements and hand them back.
  const [dims, setDims] = useState<Record<string, { width: number; height: number }>>({});
  const onNodesChange = useCallback((chs: NodeChange[]) => {
    const d = chs.filter((c): c is Extract<NodeChange, { type: "dimensions" }> => c.type === "dimensions" && !!(c as any).dimensions);
    if (d.length) setDims((cur) => { const n = { ...cur }; d.forEach((c) => { n[c.id] = c.dimensions!; }); return n; });
  }, []);
  const seq = useRef(0);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(t); }, []);

  // Observed state is built only from messages this console received (after connecting).
  const onMsg = useCallback((m: LiveMsg) => {
    const fx = effectOf(m);
    const src = m.kind === "telemetry" ? TELEMETRY_NODE[m.node || ""] : "outbox";
    const touched = new Set<string>([...(src ? [src] : []), ...fx.nodes.map((n) => n.id)]);
    setObserved((cur) => {
      const next = { ...cur };
      // Use the message's own timestamp: on connect the server replays recent history, which must not look "recent".
      const now = Date.parse((m as any).at || (m as any).occurred_at || "") || Date.now();
      touched.forEach((id) => {
        const o = next[id] || { count: 0, errors: 0 };
        const hit = fx.nodes.find((n) => n.id === id);
        const isErr = (m.level === "error" && id === src) || hit?.level === "error";
        next[id] = { ...o, count: o.count + 1, lastAt: Math.max(o.lastAt || 0, now), lastText: hit?.text || `${m.node || "event"}.${m.phase || m.type}`, lastLevel: hit?.level || m.level,
          errors: o.errors + (isErr ? 1 : 0), lastErrorAt: isErr ? Math.max(o.lastErrorAt || 0, now) : o.lastErrorAt };
      });
      return next;
    });
    if (m.kind === "telemetry" && m.node === "ledger" && m.phase === "settled") {
      const at = Date.parse(m.at || "") || Date.now();
      if (Date.now() - at < 60_000) {               // live only: never replayed history
        const d = m.detail || {};
        setSettled((cur) => [{ id: `${m.txn_ref}-${at}`, ref: m.txn_ref || "", amount: d.amount_minor || 0, merchant: d.merchant || "merchant", at }, ...cur].slice(0, 6));
        setTotals((t) => ({ n: t.n + 1, minor: t.minor + (d.amount_minor || 0) }));
        const path = ["phone-gateway", "gateway-risk", "risk-ledger", "ledger-rail", "ledger-outbox", "outbox-notification"];
        const nodesOnPath = ["phone", "gateway", "risk", "ledger", "rail", "outbox", "notification", "cashier"];
        path.forEach((edge, i) => window.setTimeout(() => {
          const pid = `w${++seq.current}`;
          setPackets((cur) => ({ ...cur, [edge]: [...(cur[edge] || []), { id: pid, color: COLORS.info, wave: true } as Packet] }));
          window.setTimeout(() => setPackets((cur) => ({ ...cur, [edge]: (cur[edge] || []).filter((p) => p.id !== pid) })), 1300);
        }, 1100 + i * 260));
        const until = Date.now() + 3500;
        setGlow((g) => { const n = { ...g }; nodesOnPath.forEach((id) => { n[id] = until; }); return n; });
        window.setTimeout(() => setGlow((g) => { const n = { ...g }; nodesOnPath.forEach((id) => { if (n[id] <= Date.now()) delete n[id]; }); return n; }), 3600);
      }
    }
    if (fx.hops.length) {
      const id = `p${++seq.current}`;
      setPackets((cur) => { const n = { ...cur }; fx.hops.forEach((h, i) => { n[h.edge] = [...(n[h.edge] || []), { id: `${id}-${i}`, color: h.color, reverse: h.reverse }]; }); return n; });
      setTimeout(() => setPackets((cur) => { const n = { ...cur }; fx.hops.forEach((h, i) => { n[h.edge] = (n[h.edge] || []).filter((p) => p.id !== `${id}-${i}`); }); return n; }), 1100);
    }
  }, []);
  useEffect(() => live.subscribe(onMsg), [live, onMsg]);

  const neighbours = useMemo(() => {
    if (!selected) return null;
    const s = new Set([selected]);
    EDGES.forEach((e) => { if (e.source === selected) s.add(e.target); if (e.target === selected) s.add(e.source); });
    return s;
  }, [selected]);

  const nodes: Node[] = useMemo(() => NODES.filter((n) => !hidden.has(NODE_INFO[n.id].layer)).map((n) => ({
    id: n.id, type: "svc", position: { x: n.x, y: n.y }, selected: n.id === selected, measured: dims[n.id],
    data: { def: n, obs: observed[n.id], glow: !!glow[n.id], dim: focus && neighbours ? !neighbours.has(n.id) : false, match: q && (n.title + n.sub).toLowerCase().includes(q.toLowerCase()) } as any,
  })), [observed, hidden, selected, focus, neighbours, q, glow, dims]);
  const visible = new Set(nodes.map((n) => n.id));
  const edges: Edge[] = useMemo(() => EDGES.filter((e) => visible.has(e.source) && visible.has(e.target)).map((e) => ({
    id: e.id, source: e.source, target: e.target, type: "wire", sourceHandle: `s-${e.sh || "r"}`, targetHandle: `t-${e.th || "l"}`,
    data: { packets: packets[e.id] || [], dashed: e.dashed, dim: focus && neighbours ? !(neighbours.has(e.source) && neighbours.has(e.target)) : false } as any,
  })), [packets, focus, neighbours, nodes.length]);

  const findNode = (text: string) => {
    setQ(text);
    const hit = NODES.find((n) => (n.title + n.sub).toLowerCase().includes(text.toLowerCase()));
    if (text && hit) { setSelected(hit.id); rf.setCenter(hit.x + 110, hit.y + 40, { zoom: 1.1, duration: 400 }); }
  };
  const sel = NODES.find((n) => n.id === selected);
  const info = selected ? NODE_INFO[selected] : null;
  const obs = selected ? observed[selected] : undefined;
  const deps = selected ? EDGES.filter((e) => e.source === selected || e.target === selected) : [];

  return (
    <Page wide title="System topology" description="Real Paya components and the messages between them. Wires animate only when this console receives a real event."
      actions={<>
        <span className={cx("text-caption", live.connected ? "text-success" : "text-warning")}>{live.connected ? "Receiving telemetry" : "Telemetry disconnected"}</span>
        <Button size="sm" variant="secondary" icon={<Maximize2 className="h-4 w-4" />} onClick={() => rf.fitView({ padding: 0.08, duration: 400 })}>Fit to screen</Button>
      </>}>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput className="w-72" value={q} onChange={findNode} placeholder="Find a component…" label="Find a component" />
        <div role="group" aria-label="Show layers" className="flex flex-wrap gap-1">
          {LAYERS.map((l) => {
            const on = !hidden.has(l.id);
            return <button key={l.id} aria-pressed={on} onClick={() => setHidden((h) => { const n = new Set(h); on ? n.add(l.id) : n.delete(l.id); return n; })}
              className={cx("rounded-md border px-2.5 py-1 text-caption transition-colors", on ? "border-line-strong bg-raised text-fg" : "border-line text-fg-muted line-through")}>{l.label}</button>;
          })}
        </div>
        <label className="ml-auto flex items-center gap-2 text-caption text-fg-2"><input type="checkbox" checked={focus} onChange={(e) => setFocus(e.target.checked)} className="accent-[rgb(var(--brand))]" />Focus on selected node and its dependencies</label>
      </div>

      <div className="relative mt-3">
        <div className="relative h-[calc(100vh-230px)] min-h-[540px] overflow-hidden rounded-lg border border-line bg-sunken">
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES} fitView fitViewOptions={{ padding: 0.03 }} minZoom={0.3} style={{ background: "transparent" }} maxZoom={1.8}
            nodesConnectable={false} proOptions={{ hideAttribution: true }} colorMode="dark" onNodeClick={(_, n) => setSelected(n.id)} onPaneClick={() => setSelected(null)}>
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(255,255,255,0.06)" />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap pannable zoomable position="bottom-right" style={{ width: 160, height: 100 }} maskColor="rgba(9,13,18,0.7)" nodeColor={(n) => {
              const o = observed[n.id]; return o?.lastErrorAt && Date.now() - o.lastErrorAt < 60000 ? COLORS.error : o?.lastAt ? "#3D7FE6" : "#303E4D"; }} />
          </ReactFlow>
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 w-[min(560px,calc(100%-380px))] -translate-x-1/2" aria-live="polite">
            <div className="rounded-md border border-line bg-surface/95 p-2.5 shadow-e2">
              <div className="flex items-center justify-between text-caption text-fg-2">
                <span className="flex items-center gap-1.5"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-success" /></span>Live settlements, any user</span>
                <span className="num">{totals.n} settled · Rs {(totals.minor / 100).toLocaleString("en-US")} since you opened this page</span>
              </div>
              {settled.length === 0 ? <p className="mt-1.5 text-caption text-fg-muted">Pay any till QR from a phone: the settlement appears here and a wave runs along the payment path.</p> : (
                <ul className="mt-1.5 space-y-1">
                  <AnimatePresence initial={false}>
                    {settled.map((x, i) => (
                      <motion.li key={x.id} layout initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: i === 0 ? 1 : 0.75 - i * 0.1, y: 0, scale: 1 }} exit={{ opacity: 0 }}
                        className={cx("flex items-center justify-between rounded px-2 py-1 text-body-sm", i === 0 ? "bg-success-soft text-fg" : "text-fg-2")}>
                        <span className="truncate"><span className="font-semibold">Rs {(x.amount / 100).toLocaleString("en-US")}</span> settled · {x.merchant}</span>
                        <span className="ref ml-3 shrink-0 text-[11px] text-fg-muted">{x.ref}</span>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </div>
          </div>
          <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-line bg-surface/95 p-2.5">
            <Legend series={[{ key: "f", label: "message in flight", color: COLORS.flow }, { key: "i", label: "confirmed fact", color: COLORS.info },
              { key: "w", label: "uncertainty / retry", color: COLORS.warn }, { key: "e", label: "failure / denial", color: COLORS.error }, { key: "h", label: "waiting for a person", color: COLORS.human }]} />
          </div>
        </div>

        {!sel || !info ? (
          <p className="pointer-events-none absolute right-3 top-3 flex max-w-[260px] items-start gap-2 rounded-md border border-line bg-surface/95 p-2.5 text-caption text-fg-2"><Crosshair className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />Click a component for its architecture facts and observed activity.</p>
        ) : (
        <Card as="aside" aria-label="Component inspector" className="absolute right-3 top-3 z-10 max-h-[calc(100%-24px)] w-[340px] overflow-y-auto p-4 shadow-e3 scrollbar-thin">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-sunken text-fg"><sel.icon className="h-5 w-5" aria-hidden /></span>
                <div className="min-w-0 flex-1"><h2 className="text-title-3 text-fg">{sel.title}</h2><p className="text-caption text-fg-2">{sel.sub}</p></div>
                <IconButton label="Close inspector" onClick={() => setSelected(null)}><X className="h-4 w-4" /></IconButton>
              </div>
              <h3 className="mt-4 text-overline uppercase text-fg-muted">Architecture · static</h3>
              <p className="mt-1 text-body-sm text-fg">{info.what}</p>
              <dl className="mt-2 space-y-1 text-body-sm">
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-fg-2">Layer</dt><dd><Badge tone={info.layer === "simulated" ? "info" : "neutral"}>{info.layer === "simulated" ? "simulator (not real infrastructure)" : info.layer}</Badge></dd></div>
                {info.owns && <div className="flex gap-2"><dt className="w-16 shrink-0 text-fg-2">Owns</dt><dd className="ref text-[12px] text-fg">{info.owns}</dd></div>}
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-fg-2">Code</dt><dd className="ref text-[12px] text-fg">{info.code}</dd></div>
              </dl>
              <h3 className="mt-4 text-overline uppercase text-fg-muted">Connections</h3>
              <ul className="mt-1 space-y-1">{deps.map((e) => {
                const other = e.source === selected ? e.target : e.source;
                const n = NODES.find((x) => x.id === other)!;
                return <li key={e.id}><button onClick={() => setSelected(other)} className="text-body-sm text-brand-accent hover:underline">{e.source === selected ? "→" : "←"} {n.title}</button></li>;
              })}</ul>
              <h3 className="mt-4 text-overline uppercase text-fg-muted">Observed · runtime</h3>
              {!obs ? <p className="mt-1 text-body-sm text-fg-2">No telemetry for this component in the server's recent buffer or since you connected. That means "no recent activity", not "healthy".</p> : (
                <dl className="mt-1 space-y-1 text-body-sm">
                  <div className="flex justify-between"><dt className="text-fg-2">Messages seen</dt><dd className="num text-fg">{obs.count}</dd></div>
                  <div className="flex justify-between"><dt className="text-fg-2">Last activity</dt><dd className="text-fg">{obs.lastAt ? ago(new Date(obs.lastAt).toISOString()) : "—"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="shrink-0 text-fg-2">Last message</dt><dd className="truncate text-right text-fg">{obs.lastText}</dd></div>
                  <div className="flex justify-between"><dt className="text-fg-2">Errors / denials</dt><dd className={cx("num", obs.errors ? "text-danger" : "text-fg")}>{obs.errors}{obs.lastErrorAt ? ` · last ${ago(new Date(obs.lastErrorAt).toISOString())}` : ""}</dd></div>
                </dl>
              )}
        </Card>
        )}
      </div>
    </Page>
  );
}

function SvcNode({ data, selected }: NodeProps) {
  const d = data as any;
  const def = d.def, obs: Observed | undefined = d.obs;
  const Icon = def.icon;
  const recentErr = obs?.lastErrorAt && Date.now() - obs.lastErrorAt < 60_000;
  const recent = obs?.lastAt && Date.now() - obs.lastAt < 60_000;
  const state = recentErr ? { text: "error in last minute", cls: "text-danger", dot: "bg-danger" } : recent ? { text: `active · ${obs!.count}`, cls: "text-processing", dot: "bg-processing" }
    : obs ? { text: `quiet · last ${ago(new Date(obs.lastAt!).toISOString())}`, cls: "text-fg-2", dot: "bg-neutral" } : { text: "no telemetry yet", cls: "text-fg-muted", dot: "bg-line-strong" };
  const simulated = NODE_INFO[def.id].layer === "simulated";
  return (
    <motion.div key={obs?.count} initial={{ scale: recent ? 1.03 : 1 }} animate={{ scale: 1 }} transition={{ duration: 0.25 }}
      className={cx("w-[224px] rounded-md border bg-surface px-3 py-2.5 transition-[opacity,border-color,box-shadow] duration-base", d.glow && "!border-success shadow-[0_0_0_3px_rgb(var(--success)/0.35),0_0_28px_rgb(var(--success)/0.45)]", selected ? "border-focus" : recentErr ? "border-danger-line" : "border-line-strong",
        d.dim && "opacity-25", d.match && "ring-2 ring-focus", simulated && "border-dashed")}>
      {(["l", "t", "b", "r"] as const).map((side) => {
        const pos = { l: Position.Left, t: Position.Top, b: Position.Bottom, r: Position.Right }[side];
        return [<Handle key={`t${side}`} id={`t-${side}`} type="target" position={pos} className="!h-1.5 !w-1.5 !border-0 !bg-line-strong" />,
          <Handle key={`s${side}`} id={`s-${side}`} type="source" position={pos} className="!h-1.5 !w-1.5 !border-0 !bg-line-strong" />];
      })}
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-sunken text-fg"><Icon className="h-4 w-4" aria-hidden /></span>
        <div className="min-w-0"><p className="truncate text-[15px] font-semibold text-fg">{def.title}</p><p className="truncate text-[12.5px] text-fg-2">{simulated ? "simulator · " : ""}{def.sub}</p></div>
      </div>
      <p className={cx("mt-2 flex items-center gap-1.5 truncate text-[12px]", state.cls)}><span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", state.dot)} />{state.text}</p>
    </motion.div>
  );
}

function Wire(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const d = (data || {}) as { packets?: Packet[]; dashed?: boolean; dim?: boolean };
  return (
    <g opacity={d.dim ? 0.15 : 1}>
      <BaseEdge id={id} path={path} style={{ stroke: "rgb(var(--line-strong))", strokeWidth: 1.5, strokeDasharray: d.dashed ? "5 6" : undefined }} />
      {(d.packets || []).some((p) => p.wave) && <path d={path} fill="none" stroke="rgb(var(--success))" strokeWidth={4} opacity={0.35} className="animate-pulse" />}
      {(d.packets || []).map((p) => p.wave ? (
        <g key={p.id}>
          {[0, 0.08, 0.16].map((lag, k) => (
            <circle key={k} r={7 - k * 2} fill="rgb(var(--success))" opacity={1 - k * 0.3} stroke={k === 0 ? "rgb(var(--surface))" : "none"} strokeWidth={2}>
              <animateMotion dur="1.1s" begin={`${lag}s`} fill="freeze" path={path} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.4 0 0.2 1" />
            </circle>
          ))}
        </g>
      ) : (
        <circle key={p.id} r={5} fill={p.color} stroke="rgb(var(--surface))" strokeWidth={2}>
          <animateMotion dur="0.95s" fill="freeze" path={path} keyPoints={p.reverse ? "1;0" : "0;1"} keyTimes="0;1" calcMode="linear" />
        </circle>
      ))}
    </g>
  );
}

const NODE_TYPES = { svc: SvcNode };
const EDGE_TYPES = { wire: Wire };
