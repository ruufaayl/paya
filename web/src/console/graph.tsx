// Mission Control graph: every node is a real Rupay component; every packet is a real event from the live stream.
import {
  Bell, Bot, BrainCircuit, MessagesSquare, Database, FileCheck2, Fingerprint, Gavel, IdCard, Landmark, ScrollText, ShieldCheck, Smartphone, Store,
  UserCheck, Workflow, Zap,
} from "lucide-react";
import type { StreamMsg } from "../lib/stream";

export type Level = "idle" | "info" | "warn" | "error" | "human";
export interface NodeState { level: Level; last?: string; count: number; badge?: number; pulseKey?: number }
export interface Packet { id: string; color: string; reverse?: boolean; wave?: boolean }

// Wire colours: confirmed fact = green, message in flight = blue, uncertainty = amber, failure = red-orange, human = violet.
export const COLORS = { info: "#2FA36B", flow: "#3D7FE6", warn: "#D9A23A", error: "#E0603A", human: "#A86BC0" };

type Kind = "channel" | "service" | "agent" | "human" | "store" | "planned" | "chaos";
export interface NodeDef { id: string; title: string; sub: string; icon: any; kind: Kind; x: number; y: number }
export type Layer = "channel" | "core" | "simulated" | "human" | "agent" | "store";
/** Static architecture facts per node (what it is, what it owns, what it depends on). Not runtime state. */
export const NODE_INFO: Record<string, { layer: Layer; what: string; owns?: string; code: string }> = {
  phone: { layer: "channel", what: "Customer wallet PWA: onboarding, scan, review, authorise, receipts.", code: "web/src/wallet" },
  cashier: { layer: "channel", what: "Merchant till: dynamic QR and PAID only after settlement.", code: "web/src/wallet/Cashier.tsx" },
  registry: { layer: "simulated", what: "Simulated identity registry with synthetic SPECIMEN identities; chaos modes TIMEOUT/DOWN.", owns: "schema registry", code: "src/paya/registry.py" },
  assistant: { layer: "agent", what: "Conversational banking: deterministic intents (EN + Roman Urdu) over read-only, customer-scoped tools; redacts secrets before storage; hands off to Ops with a case. Cannot move money.", owns: "conversations, chat_messages", code: "src/paya/assistant.py" },
  kyc: { layer: "core", what: "Document checks, head-turn liveness, face match, screening, duplicates, location; refers anything unclear.", owns: "kyc_applications, kyc_checks", code: "src/paya/kyc.py" },
  gateway: { layer: "core", what: "FastAPI gateway: JWT auth, RBAC, idempotency keys, correlation ids, security headers.", owns: "idempotency_records", code: "src/paya/api" },
  risk: { layer: "core", what: "Deterministic KYC/AML/velocity rules, versioned and evidenced.", owns: "screening_results", code: "src/paya/risk.py" },
  compliance: { layer: "human", what: "Compliance officers: holds and KYC referrals; two-person rule for possible sanctions matches.", code: "cases, approvals" },
  ledger: { layer: "store", what: "Append-only double-entry ledger; DB triggers reject unbalanced or edited journals.", owns: "accounts, journals, ledger_entries, holds", code: "src/paya/ledger.py" },
  audit: { layer: "store", what: "Hash-chained audit log; every allow and deny recorded.", owns: "audit_log", code: "src/paya/audit.py" },
  outbox: { layer: "store", what: "Transactional outbox and inbox: at-least-once delivery, duplicate-safe consumers.", owns: "outbox, processed_events", code: "src/paya/events.py" },
  rail: { layer: "simulated", what: "Simulated Raast rail behind RailPort with nine failure modes and a circuit breaker. Not real Raast.", owns: "schema rail", code: "src/paya/rail.py" },
  enquiry: { layer: "agent", what: "Recovery worker: status enquiry with backoff; resends the same E2E id only if the rail never saw it.", code: "src/paya/worker.py" },
  chaos: { layer: "simulated", what: "Demo-mode switchboard that injects real failures into the simulators.", code: "/v1/chaos/*" },
  notification: { layer: "core", what: "Notifier: consumes facts from the outbox only; never decides status.", owns: "notifications", code: "src/paya/notifications.py" },
  recon: { layer: "agent", what: "Daily reconciliation against the rail settlement file; 7 categories, file-hash dedupe.", owns: "recon_runs, recon_items", code: "src/paya/recon.py" },
  ops: { layer: "human", what: "Operations and Finance: pending reviews, reversals (maker-checker), recon breaks.", code: "cases, approvals" },
  ai: { layer: "agent", what: "Reconciliation-triage agent: rules first, optional guarded LLM; suggestions only, never decisions.", owns: "ai_suggestions", code: "src/paya/ai_service.py" },
};
/** Which live telemetry sources belong to which node (for observed activity counts). */
export const TELEMETRY_NODE: Record<string, string> = {
  merchant: "cashier", gateway: "gateway", risk: "risk", ledger: "ledger", rail: "rail", transaction: "ledger", notification: "notification",
  "notification-service": "notification", "rail-ack-consumer": "outbox", recon: "recon", human_gate: "ops", security: "gateway", chaos: "chaos",
  ai: "ai", dlq: "outbox", worker: "enquiry", kyc: "kyc", assistant: "assistant",
};

export const NODES: NodeDef[] = [
  { id: "phone", title: "Customer wallet", sub: "PWA on phone", icon: Smartphone, kind: "channel", x: 0, y: 80 },
  { id: "registry", title: "Identity registry", sub: "simulated - synthetic IDs only", icon: IdCard, kind: "service", x: 0, y: -130 },
  { id: "assistant", title: "Rupay Assistant", sub: "chat - read-only - can't move money", icon: MessagesSquare, kind: "agent", x: 270, y: 60 },
  { id: "kyc", title: "Onboarding & KYC", sub: "document - liveness - face - screening", icon: Fingerprint, kind: "service", x: 270, y: -130 },
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
  { id: "ai", title: "AI triage agent", sub: "suggests - never decides", icon: BrainCircuit, kind: "agent", x: 1350, y: 500 },
];

export interface EdgeDef { id: string; source: string; target: string; sh?: string; th?: string; dashed?: boolean }
// sh/th = source/target handle side: r(ight) b(ottom) t(op) l(eft)
export const EDGES: EdgeDef[] = [
  { id: "phone-gateway", source: "phone", target: "gateway" },
  { id: "phone-kyc", source: "phone", target: "kyc", sh: "t", th: "l" },
  { id: "phone-assistant", source: "phone", target: "assistant" },
  { id: "assistant-risk", source: "assistant", target: "ops", sh: "t", th: "t", dashed: true },
  { id: "kyc-registry", source: "kyc", target: "registry", sh: "l", th: "r" },
  { id: "kyc-compliance", source: "kyc", target: "compliance" },
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
  { id: "recon-ai", source: "recon", target: "ai", sh: "b", th: "t" },
  { id: "ai-ops", source: "ai", target: "ops", sh: "r", th: "r", dashed: true },
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
    case "gateway:title_fetch": hop("phone-gateway", COLORS.flow); node("gateway", "info", `account title fetch · ${d.bank} (simulated)`); break;
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
    case "assistant:replied": hop("phone-assistant", d.redacted?.length ? COLORS.warn : COLORS.flow); node("assistant", d.handoff ? "human" : d.redacted?.length ? "warn" : "info", `${String(d.intent).toLowerCase()}${d.redacted?.length ? " · redacted" : ""}`); if (d.handoff) { hop("assistant-risk", COLORS.human); node("ops", "human", "chat handed to a person"); } break;
    case "kyc:started": hop("phone-kyc", COLORS.flow); node("kyc", "info", `application ${d.ref}`); break;
    case "kyc:check":
      if (d.check === "REGISTRY") { hop("kyc-registry", COLORS.flow); node("registry", d.outcome === "PASS" ? "info" : "warn", d.outcome === "PASS" ? "identity matched" : d.reason); }
      if (d.check === "DOCUMENT_QUALITY" || d.check === "LIVENESS") hop("phone-kyc", d.outcome === "PASS" ? COLORS.flow : COLORS.warn);
      node("kyc", d.outcome === "PASS" ? "info" : d.outcome === "ERROR" ? "error" : "warn",
        `${String(d.check).toLowerCase().replace(/_/g, " ")}: ${d.outcome}${d.score != null ? ` ${d.score}` : ""}${d.reason ? ` (${d.reason})` : ""}`);
      break;
    case "kyc:state_changed":
      if (d.to === "REFERRED") { hop("kyc-compliance", COLORS.human); node("kyc", "warn", "referred to a person"); node("compliance", "human", `KYC ${d.ref}`); }
      if (d.to === "APPROVED") { hop("phone-kyc", COLORS.info, true); node("kyc", "info", `wallet opened (${d.reason?.startsWith("MANUAL") ? "by Compliance" : "auto"})`); node("phone", "info", "new wallet"); }
      if (d.to === "REJECTED") node("kyc", "error", "application rejected");
      if (d.to === "ABANDONED") node("kyc", "warn", "abandoned - personal data purged");
      break;
    case "human_gate:kyc_recommended": node("compliance", "human", `${d.by} recommends - second officer needed`); break;
    case "human_gate:kyc_decided": hop("kyc-compliance", d.decision === "APPROVE" ? COLORS.info : COLORS.error, true); node("compliance", d.decision === "REJECT" ? "error" : "info", `KYC ${d.decision.toLowerCase()} by ${d.by}`); break;
    case "chaos:registry_mode_changed": hop("kyc-registry", d.mode === "NORMAL" ? COLORS.info : COLORS.error); node("registry", d.mode === "NORMAL" ? "info" : "error", d.mode === "NORMAL" ? "healthy" : d.mode.toLowerCase()); node("chaos", d.mode === "NORMAL" ? "info" : "error", `registry ${d.mode}`); break;
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

