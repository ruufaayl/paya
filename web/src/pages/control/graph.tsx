// Mission Control graph: every node is a real Paya component; every packet is a real event from the live stream.
import { BaseEdge, getBezierPath, Handle, Position, type EdgeProps, type NodeProps } from "@xyflow/react";
import { motion } from "framer-motion";
import {
  Bell, Bot, BrainCircuit, Database, FileCheck2, Gavel, Landmark, ScrollText, ShieldCheck, Smartphone, Store,
  UserCheck, Workflow, Zap,
} from "lucide-react";
import type { StreamMsg } from "../../lib/stream";

export type Level = "idle" | "info" | "warn" | "error" | "human";
export interface NodeState { level: Level; last?: string; count: number; badge?: number; pulseKey?: number }
export interface Packet { id: string; color: string; reverse?: boolean }

export const COLORS = { info: "#2EE58C", flow: "#5CC8FF", warn: "#FFC24B", error: "#FF6B81", human: "#A78BFA" };

type Kind = "channel" | "service" | "agent" | "human" | "store" | "planned" | "chaos";
export interface NodeDef { id: string; title: string; sub: string; icon: any; kind: Kind; x: number; y: number }

export const NODES: NodeDef[] = [
  { id: "phone", title: "Customer wallet", sub: "PWA on phone", icon: Smartphone, kind: "channel", x: 0, y: 80 },
  { id: "cashier", title: "Merchant till", sub: "Cashier screen", icon: Store, kind: "channel", x: 0, y: 430 },
  { id: "gateway", title: "API gateway", sub: "auth - idempotency - correlation", icon: ShieldCheck, kind: "service", x: 270, y: 250 },
  { id: "risk", title: "Risk engine", sub: "KYC - AML - velocity rules", icon: Gavel, kind: "service", x: 540, y: 80 },
  { id: "compliance", title: "Compliance officer", sub: "human gate", icon: UserCheck, kind: "human", x: 540, y: -130 },
  { id: "ledger", title: "Double-entry ledger", sub: "append-only - balanced", icon: Landmark, kind: "store", x: 810, y: 250 },
  { id: "audit", title: "Audit chain", sub: "hash-linked evidence", icon: ScrollText, kind: "store", x: 270, y: 480 },
  { id: "outbox", title: "Event outbox", sub: "at-least-once delivery", icon: Database, kind: "store", x: 810, y: 480 },
  { id: "rail", title: "Raast rail", sub: "simulated - separate system", icon: Zap, kind: "service", x: 1080, y: 110 },
  { id: "enquiry", title: "Recovery agent", sub: "status enquiry - resend same E2E", icon: Bot, kind: "agent", x: 1080, y: -130 },
  { id: "chaos", title: "Chaos switch", sub: "inject real failures", icon: Workflow, kind: "chaos", x: 1350, y: -130 },
  { id: "notification", title: "Notifier", sub: "consumes facts only", icon: Bell, kind: "service", x: 1080, y: 480 },
  { id: "recon", title: "Reconciliation agent", sub: "ledger vs Raast file", icon: FileCheck2, kind: "agent", x: 1350, y: 300 },
  { id: "ops", title: "Ops & Finance", sub: "maker-checker gate", icon: UserCheck, kind: "human", x: 1350, y: 90 },
  { id: "ai", title: "AI triage agent", sub: "suggests - never decides", icon: BrainCircuit, kind: "agent", x: 1620, y: 300 },
];

export interface EdgeDef { id: string; source: string; target: string; sh?: string; th?: string; dashed?: boolean }
// sh/th = source/target handle side: r(ight) b(ottom) t(op) l(eft)
export const EDGES: EdgeDef[] = [
  { id: "phone-gateway", source: "phone", target: "gateway" },
  { id: "cashier-gateway", source: "cashier", target: "gateway" },
  { id: "gateway-risk", source: "gateway", target: "risk" },
  { id: "risk-compliance", source: "risk", target: "compliance", sh: "t", th: "b" },
  { id: "compliance-ledger", source: "compliance", target: "ledger", th: "t" },
  { id: "risk-ledger", source: "risk", target: "ledger" },
  { id: "gateway-audit", source: "gateway", target: "audit", sh: "b", th: "t" },
  { id: "ledger-rail", source: "ledger", target: "rail" },
  { id: "enquiry-rail", source: "enquiry", target: "rail", sh: "b", th: "t" },
  { id: "chaos-rail", source: "chaos", target: "rail", sh: "b", th: "r", dashed: true },
  { id: "ledger-outbox", source: "ledger", target: "outbox", sh: "b", th: "t" },
  { id: "outbox-notification", source: "outbox", target: "notification" },
  { id: "rail-recon", source: "rail", target: "recon" },
  { id: "recon-ledger", source: "recon", target: "ledger", sh: "b", th: "b", dashed: false },
  { id: "recon-ops", source: "recon", target: "ops", sh: "t", th: "b" },
  { id: "ops-ledger", source: "ops", target: "ledger", sh: "l", th: "t" },
  { id: "rail-ops", source: "rail", target: "ops" },
  { id: "recon-ai", source: "recon", target: "ai" },
  { id: "ai-ops", source: "ai", target: "ops", sh: "t", th: "r", dashed: true },
];

type Hop = { edge: string; color: string; reverse?: boolean };
export interface Effect { hops: Hop[]; nodes: { id: string; level: Level; text: string }[] }

/** Translate one live message into wire animations and node highlights. */
export function effectOf(m: StreamMsg): Effect {
  const e: Effect = { hops: [], nodes: [] };
  const hop = (edge: string, color: string, reverse = false) => e.hops.push({ edge, color, reverse });
  const node = (id: string, level: Level, text: string) => e.nodes.push({ id, level, text });
  if (m.kind === "event") {
    const t = m.type || "";
    hop("ledger-outbox", COLORS.flow);
    node("outbox", "info", t);
    if (t === "case.opened") node(m.payload?.owner_role === "COMPLIANCE" ? "compliance" : "ops", "human", m.payload?.summary || "case");
    if (t === "recon.completed") node("recon", "info", `match rate ${Math.round((m.payload?.match_rate || 0) * 100)}%`);
    return e;
  }
  const p = `${m.node}:${m.phase}`;
  const d = m.detail || {};
  switch (p) {
    case "merchant:payment_request_created": hop("cashier-gateway", COLORS.flow); node("cashier", "info", `QR for Rs ${(d.amount_minor || 0) / 100}`); break;
    case "gateway:accepted": hop("phone-gateway", COLORS.flow); node("gateway", "info", "request accepted"); break;
    case "gateway:idempotent_replay": hop("phone-gateway", COLORS.warn); node("gateway", "warn", "retry replayed - no double debit"); break;
    case "risk:screening": hop("gateway-risk", COLORS.flow); node("risk", "info", "screening"); break;
    case "risk:passed": hop("risk-ledger", COLORS.info); node("risk", "info", "all rules passed"); break;
    case "risk:held": hop("risk-compliance", COLORS.warn); node("risk", "warn", (d.rules || []).map((r: any) => r.rule).join(", ")); node("compliance", "human", "decision needed"); break;
    case "risk:rejected": hop("gateway-risk", COLORS.error, true); node("risk", "error", (d.rules || []).map((r: any) => r.rule).join(", ")); break;
    case "ledger:hold_placed": node("ledger", "info", "funds reserved"); break;
    case "ledger:posted": node("ledger", "info", "Dr wallet / Cr in-transit"); break;
    case "ledger:insufficient_funds": node("ledger", "error", "insufficient funds"); break;
    case "ledger:settled": hop("ledger-rail", COLORS.info, true); node("ledger", "info", "Dr in-transit / Cr settlement"); break;
    case "ledger:reversed": node("ledger", "warn", "compensating reversal posted"); break;
    case "rail:sending": hop("ledger-rail", COLORS.flow); node("rail", "info", "credit transfer sent"); break;
    case "rail:answer_accepted": hop("ledger-rail", COLORS.info, true); node("rail", "info", `ACCEPTED (${d.source})`); break;
    case "rail:answer_rejected": hop("ledger-rail", COLORS.error, true); node("rail", "error", "REJECTED by rail"); break;
    case "rail:timeout_unknown_outcome": node("rail", "warn", "timeout - outcome unknown"); node("enquiry", "warn", "will ask the rail"); break;
    case "rail:unavailable": node("rail", "error", "unreachable"); break;
    case "rail:circuit_open_refused": hop("phone-gateway", COLORS.error, true); node("gateway", "error", "circuit open - refused before debit"); break;
    case "rail:status_enquiry": hop("enquiry-rail", COLORS.human); node("enquiry", "info", "status enquiry"); break;
    case "rail:resend_same_e2e": hop("enquiry-rail", COLORS.warn); node("enquiry", "warn", "rail never got it - resend same E2E"); break;
    case "rail:duplicate_ack_ignored": node("ledger", "warn", "duplicate ack ignored"); break;
    case "transaction:state_changed":
      if (d.to === "PENDING") node("ledger", "info", "handed to clearing");
      if (d.to === "UNDER_REVIEW") node("ops", "human", d.reason);
      if (d.to === "RECONCILED") hop("recon-ledger", COLORS.info);
      break;
    case "notification:sent": hop("outbox-notification", COLORS.flow); node("notification", "info", d.event); node("phone", "info", `notified: ${d.event}`); node("cashier", "info", `notified: ${d.event}`); break;
    case "notification-service:duplicate_ignored": case "rail-ack-consumer:duplicate_ignored": node("notification", "warn", "duplicate event ignored"); break;
    case "recon:run_started": hop("rail-recon", COLORS.flow); node("recon", "info", `file ${d.file_id} - ${d.records} lines`); break;
    case "recon:matched": hop("recon-ledger", COLORS.info); break;
    case "recon:timing_difference": node("recon", "warn", "timing difference"); break;
    case "recon:missing_external": case "recon:missing_internal": case "recon:duplicate_external": case "recon:amount_mismatch": case "recon:status_mismatch":
      hop("recon-ops", COLORS.error); hop("recon-ai", COLORS.human); node("recon", "error", m.phase!.replace(/_/g, " ")); node("ops", "human", "break needs an owner"); break;
    case "recon:duplicate_file_refused": node("recon", "warn", "same file twice - refused"); break;
    case "human_gate:case_opened": node(d.owner === "COMPLIANCE" ? "compliance" : "ops", "human", `${d.kind} ${d.case_ref}`); break;
    case "human_gate:compliance_release": hop("compliance-ledger", COLORS.info); node("compliance", "info", `released by ${d.by}`); break;
    case "human_gate:compliance_reject": node("compliance", "error", `rejected by ${d.by}`); break;
    case "human_gate:reversal_requested": node("ops", "human", `maker: ${d.maker}`); break;
    case "human_gate:reversal_approved": hop("ops-ledger", COLORS.warn); node("ops", "info", `checker: ${d.checker}`); break;
    case "security:access_denied": hop("gateway-audit", COLORS.error); node("gateway", "error", `${d.user} denied ${d.permission}`); node("audit", "error", "denial recorded"); break;
    case "chaos:rail_mode_changed": hop("chaos-rail", d.mode === "NORMAL" ? COLORS.info : COLORS.error); node("chaos", d.mode === "NORMAL" ? "info" : "error", d.mode); break;
    case "chaos:duplicate_event_injected": hop("outbox-notification", COLORS.warn); node("chaos", "warn", "duplicate event injected"); break;
    case "ai:suggested": hop("recon-ai", COLORS.human); hop("ai-ops", COLORS.human); node("ai", "info", `${d.action} (${Math.round((d.confidence || 0) * 100)}%)`); break;
    case "ai:abstained": hop("ai-ops", COLORS.warn); node("ai", "warn", "abstained - human decides"); break;
    case "ai:error": node("ai", "error", "agent error - payments unaffected"); break;
    case "human_gate:case_resolved": node("ops", "info", `closed: ${d.resolution} by ${d.by}`); break;
    case "dlq:consumer_error": node("outbox", "error", "consumer error - parked"); break;
    case "worker:error": node("enquiry", "error", "worker error"); break;
    default: break;
  }
  return e;
}

const KIND_STYLE: Record<Kind, string> = {
  channel: "from-sky-500/20 to-sky-500/0 text-sky-300",
  service: "from-paya-500/20 to-paya-500/0 text-paya-300",
  agent: "from-violet-400/25 to-violet-400/0 text-violet-300",
  human: "from-violet-400/25 to-violet-400/0 text-violet-300",
  store: "from-slate-400/20 to-slate-400/0 text-slate-200",
  planned: "from-slate-600/20 to-slate-600/0 text-slate-500",
  chaos: "from-rose-500/20 to-rose-500/0 text-rose-300",
};
const LEVEL_RING: Record<Level, string> = {
  idle: "ring-white/10", info: "ring-paya-400/70 shadow-glow", warn: "ring-amber-400/80 shadow-amber",
  error: "ring-rose-400/80 shadow-rose", human: "ring-violet-400/80",
};

export function ServiceNode({ data }: NodeProps) {
  const d = data as unknown as { def: NodeDef; state: NodeState };
  const { def, state } = d;
  const Icon = def.icon;
  const human = def.kind === "human";
  return (
    <motion.div key={state.pulseKey} initial={{ scale: state.level === "idle" ? 1 : 1.06 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 18 }}
      className={`relative w-[218px] rounded-2xl bg-ink-900/95 p-3 ring-1 transition-shadow duration-500 ${LEVEL_RING[state.level]} ${def.kind === "planned" ? "opacity-60 [border-style:dashed]" : ""}`}>
      {(["l", "t", "b", "r"] as const).map((side) => {
        const pos = { l: Position.Left, t: Position.Top, b: Position.Bottom, r: Position.Right }[side];
        return [
          <Handle key={`t${side}`} id={`t-${side}`} type="target" position={pos} className="!h-1.5 !w-1.5 !border-0 !bg-ink-600" />,
          <Handle key={`s${side}`} id={`s-${side}`} type="source" position={pos} className="!h-1.5 !w-1.5 !border-0 !bg-ink-600" />,
        ];
      })}
      <div className="flex items-center gap-3">
        <span className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-b ${KIND_STYLE[def.kind]}`}>
          <Icon size={19} />
          {(human && (state.badge || 0) > 0) && <span className="pulse-ring absolute inset-0 rounded-xl text-violet-400" />}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-slate-100">{def.title}</p>
          <p className="truncate text-[11.5px] text-slate-500">{def.sub}</p>
        </div>
        {(state.badge || 0) > 0 && (
          <span className="ml-auto rounded-full bg-violet-500 px-2 py-0.5 text-[11px] font-bold text-white">{state.badge}</span>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-black/30 px-2 py-1">
        <span className={`truncate font-mono text-[11.5px] ${state.level === "error" ? "text-rose-300" : state.level === "warn" ? "text-amber-300" : state.level === "human" ? "text-violet-300" : "text-slate-400"}`}>
          {state.last || (def.kind === "planned" ? "not active in this build" : "idle")}
        </span>
        <span className="num font-mono text-[10px] text-slate-600">{state.count}</span>
      </div>
    </motion.div>
  );
}

export function PacketEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const d = (data || {}) as { packets?: Packet[]; dashed?: boolean; hot?: string };
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: d.hot || "rgba(148,163,184,0.18)", strokeWidth: d.hot ? 2 : 1.5, strokeDasharray: d.dashed ? "5 6" : undefined, transition: "stroke .4s" }} />
      {(d.packets || []).map((p) => (
        <g key={p.id}>
          <circle r={9} fill={p.color} opacity={0.18}>
            <animateMotion dur="0.95s" fill="freeze" path={path} keyPoints={p.reverse ? "1;0" : "0;1"} keyTimes="0;1" calcMode="linear" />
          </circle>
          <circle r={4.5} fill={p.color}>
            <animateMotion dur="0.95s" fill="freeze" path={path} keyPoints={p.reverse ? "1;0" : "0;1"} keyTimes="0;1" calcMode="linear" />
          </circle>
        </g>
      ))}
    </>
  );
}
