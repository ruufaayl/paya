import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, FileSearch, Play, Repeat, ShieldOff, Siren, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Spinner, StatusPill } from "../../components/ui";
import { ApiError, call, newIdempotencyKey, pkr } from "../../lib/api";
import { msgRef, type StreamMsg } from "../../lib/stream";

export type Toast = (text: string, tone?: "ok" | "warn" | "err") => void;

const MODES: { mode: string; label: string; hint: string; tone: string }[] = [
  { mode: "NORMAL", label: "Healthy", hint: "Accept & acknowledge", tone: "paya" },
  { mode: "TIMEOUT_AFTER_ACCEPT", label: "Lost reply", hint: "Rail paid it, our call timed out", tone: "amber" },
  { mode: "TIMEOUT_NO_RECORD", label: "Lost request", hint: "Rail never received it", tone: "amber" },
  { mode: "DUPLICATE_ACK", label: "Double ack", hint: "Acknowledgement arrives twice", tone: "amber" },
  { mode: "REJECT", label: "Reject", hint: "Rail rejects after we debited", tone: "rose" },
  { mode: "PARTIAL", label: "Missing line", hint: "Paid, but absent from file", tone: "rose" },
  { mode: "LATE_SETTLE", label: "Late file", hint: "Lands in tomorrow's file", tone: "amber" },
  { mode: "DOWN", label: "Outage", hint: "Rail unreachable - breaker", tone: "rose" },
];
const TONE: Record<string, string> = {
  paya: "ring-paya-500/40 text-paya-300 data-[on=true]:bg-paya-500/20",
  amber: "ring-amber-400/40 text-amber-300 data-[on=true]:bg-amber-400/20",
  rose: "ring-rose-500/40 text-rose-300 data-[on=true]:bg-rose-500/20",
};

async function act<T>(fn: () => Promise<T>, toast: Toast, ok: string): Promise<T | undefined> {
  try { const r = await fn(); toast(ok, "ok"); return r; }
  catch (e) { toast(e instanceof ApiError ? `${e.code}: ${e.message}` : "Request failed", e instanceof ApiError && e.status === 403 ? "warn" : "err"); }
}

export function ChaosPanel({ railMode, toast }: { railMode: string; toast: Toast }) {
  const [amount, setAmount] = useState(2450);
  const [who, setWho] = useState("sara");
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (k: string, fn: () => Promise<any>) => { setBusy(k); try { await fn(); } finally { setBusy(null); } };

  const simulate = (sameKeyTwice = false) => run(sameKeyTwice ? "retry" : "pay", async () => {
    const pr = await call<any>("ayesha.cashier", "/v1/payment-requests", { method: "POST", body: JSON.stringify({ amount_minor: amount * 100, order_ref: `SIM-${Date.now().toString(36).toUpperCase()}` }) });
    const key = newIdempotencyKey();
    const body = JSON.stringify({ payment_request_id: pr.data.id });
    const r = await act(() => call<any>(who, "/v1/payments", { method: "POST", idempotencyKey: key, body }), toast, `${who} paid Rs ${amount.toLocaleString()}`);
    if (sameKeyTwice && r) {
      const again = await call<any>(who, "/v1/payments", { method: "POST", idempotencyKey: key, body });
      toast(`Retry with same key -> ${again.data.txn_ref} (replayed: ${again.headers.get("Idempotent-Replayed")})`, "warn");
    }
  });

  return (
    <div className="space-y-5">
      <section>
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Generate a payment</h4>
        <div className="flex gap-2">
          <select value={who} onChange={(e) => setWho(e.target.value)} className="flex-1 rounded-xl bg-ink-850 px-2 py-2 text-xs ring-1 ring-white/10">
            <option value="sara">Sara (verified)</option><option value="omar">Omar (tier 1)</option>
            <option value="zarak">Zarak (watch-list)</option><option value="hina">Hina (no KYC)</option>
          </select>
          <input type="number" value={amount} onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))} className="num w-24 rounded-xl bg-ink-850 px-2 py-2 text-xs ring-1 ring-white/10" />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Btn onClick={() => simulate(false)} busy={busy === "pay"} icon={<Play size={14} />}>Pay now</Btn>
          <Btn onClick={() => simulate(true)} busy={busy === "retry"} icon={<Repeat size={14} />}>Pay + retry</Btn>
        </div>
      </section>

      <section>
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Raast rail behaviour</h4>
        <div className="grid grid-cols-2 gap-2">
          {MODES.map((m) => (
            <button key={m.mode} data-on={railMode === m.mode} title={m.hint}
              onClick={() => run(m.mode, () => act(() => call("admin", "/v1/chaos/rail", { method: "POST", body: JSON.stringify({ mode: m.mode }) }), toast, `Rail -> ${m.label}`))}
              className={`rounded-xl px-2.5 py-2 text-left ring-1 transition hover:bg-white/5 ${TONE[m.tone]}`}>
              <span className="block text-xs font-semibold">{busy === m.mode ? "..." : m.label}</span>
              <span className="block truncate text-[10px] text-slate-500">{m.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Operations</h4>
        <div className="grid gap-2">
          <Btn onClick={() => run("enq", () => act(() => call("sana.ops", "/v1/ops/transactions/ALL/enquiry", { method: "POST" }), toast, "Status enquiry sweep done"))} busy={busy === "enq"} icon={<FileSearch size={14} />}>Ask rail about pending payments</Btn>
          <Btn onClick={() => run("recon", () => act(() => call("rabia.finance", "/v1/finance/recon/run", { method: "POST", body: "{}" }), toast, "Reconciliation complete"))} busy={busy === "recon"} icon={<Check size={14} />}>Run reconciliation (Rabia)</Btn>
          <Btn onClick={() => run("dupfile", () => act(() => call("rabia.finance", "/v1/finance/recon/run", { method: "POST", body: "{}" }), toast, "Imported"))} busy={busy === "dupfile"} icon={<Copy size={14} />}>Import same file again</Btn>
          <Btn onClick={() => run("dup", () => act(() => call("admin", "/v1/chaos/relay-duplicate", { method: "POST" }), toast, "Duplicate event delivered"))} busy={busy === "dup"} icon={<Siren size={14} />}>Inject duplicate event</Btn>
          <Btn onClick={() => run("deny", () => act(() => call("ayesha.cashier", "/v1/finance/recon/run", { method: "POST", body: "{}" }), toast, "?"))} busy={busy === "deny"} icon={<ShieldOff size={14} />}>Cashier tries finance action</Btn>
        </div>
      </section>
    </div>
  );
}

function Btn({ children, onClick, busy, icon }: { children: React.ReactNode; onClick: () => void; busy?: boolean; icon?: React.ReactNode }) {
  return (
    <motion.button whileTap={{ scale: 0.97 }} onClick={onClick} disabled={busy}
      className="flex items-center gap-2 rounded-xl bg-white/[0.04] px-3 py-2 text-left text-xs font-medium text-slate-200 ring-1 ring-white/10 hover:bg-white/[0.08] disabled:opacity-50">
      {busy ? <Spinner className="h-3.5 w-3.5" /> : icon}{children}
    </motion.button>
  );
}

interface CaseRow { case_ref: string; kind: string; state: string; owner_role: string; summary: string; txn_ref: string | null; details: any; sla_due_at: string; overdue: boolean; created_at: string }
interface ApprovalRow { id: string; action: string; status: string; txn_ref: string; amount: { minor: number }; maker: string; checker: string | null; reason: string }

export function GatesPanel({ tick, toast, onOpen }: { tick: number; toast: Toast; onOpen: (ref: string) => void }) {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const load = useCallback(() => {
    call<CaseRow[]>("auditor", "/v1/cases").then((r) => setCases(r.data)).catch(() => undefined);
    call<ApprovalRow[]>("auditor", "/v1/finance/approvals").then((r) => setApprovals(r.data.filter((a) => a.status === "REQUESTED"))).catch(() => undefined);
  }, []);
  useEffect(() => { load(); }, [load, tick]);
  const after = () => setTimeout(load, 400);

  return (
    <div className="space-y-3">
      <AnimatePresence initial={false}>
        {approvals.map((a) => (
          <motion.div key={a.id} layout initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
            className="rounded-2xl bg-violet-500/10 p-3 ring-1 ring-violet-400/40">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-violet-300"><span className="h-2 w-2 animate-pulse rounded-full bg-violet-400" /> Waiting for a checker</div>
            <p className="mt-1 text-sm">Reverse <button className="font-mono text-sky-300" onClick={() => onOpen(a.txn_ref)}>{a.txn_ref}</button> - {pkr(a.amount.minor)}</p>
            <p className="text-xs text-slate-400">Maker: {a.maker} - "{a.reason}"</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button onClick={() => act(() => call("faisal.ops", `/v1/finance/approvals/${a.id}/approve`, { method: "POST" }), toast, "?").then(after)}
                className="rounded-xl bg-white/5 px-2 py-2 text-[11px] text-slate-300 ring-1 ring-white/10">Approve as Ops (should fail)</button>
              <button onClick={() => act(() => call("rabia.finance", `/v1/finance/approvals/${a.id}/approve`, { method: "POST" }), toast, "Reversal approved by Rabia (Finance)").then(after)}
                className="rounded-xl bg-violet-500 px-2 py-2 text-[11px] font-semibold text-white">Approve as Rabia (Finance)</button>
            </div>
          </motion.div>
        ))}
        {cases.length === 0 && approvals.length === 0 && (
          <p className="rounded-2xl bg-white/[0.03] p-4 text-center text-xs text-slate-500">No human decisions pending. Machines are handling everything they are allowed to.</p>
        )}
        {cases.map((c) => (
          <motion.div key={c.case_ref} layout initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
            className={`rounded-2xl p-3 ring-1 ${c.kind === "RECON_BREAK" ? "bg-rose-500/[0.07] ring-rose-500/30" : "bg-amber-400/[0.07] ring-amber-400/30"}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-slate-300">{c.kind.replace(/_/g, " ")}</span>
              <span className="rounded-full bg-black/30 px-2 py-0.5 text-[10px] text-slate-400">owner: {c.owner_role}{c.overdue ? " - OVERDUE" : ""}</span>
            </div>
            <p className="mt-1 text-sm text-slate-200">{c.summary}</p>
            {c.txn_ref && <button className="mt-0.5 font-mono text-[11px] text-sky-300" onClick={() => onOpen(c.txn_ref!)}>{c.txn_ref}</button>}
            {c.kind === "COMPLIANCE_HOLD" && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button onClick={() => act(() => call("hamza.compliance", `/v1/compliance/holds/${c.txn_ref}/decision`, { method: "POST", body: JSON.stringify({ decision: "REJECT", reason: "Confirmed watch-list match after review" }) }), toast, "Rejected by Hamza (Compliance)").then(after)}
                  className="rounded-xl bg-rose-500/20 px-2 py-2 text-[11px] font-semibold text-rose-200 ring-1 ring-rose-500/40">Reject as Hamza</button>
                <button onClick={() => act(() => call("hamza.compliance", `/v1/compliance/holds/${c.txn_ref}/decision`, { method: "POST", body: JSON.stringify({ decision: "RELEASE", reason: "False positive: different DOB and city on file" }) }), toast, "Released by Hamza (Compliance)").then(after)}
                  className="rounded-xl bg-paya-400 px-2 py-2 text-[11px] font-semibold text-ink-950">Release as Hamza</button>
              </div>
            )}
            {c.kind === "PENDING_REVIEW" && (
              <button onClick={() => act(() => call("sana.ops", `/v1/ops/transactions/${c.txn_ref}/reversal-requests`, { method: "POST", body: JSON.stringify({ reason: "Rail silent beyond SLA; return funds to customer" }) }), toast, "Reversal requested by Sana (Ops) - needs a checker").then(after)}
                className="mt-2 w-full rounded-xl bg-amber-400 px-2 py-2 text-[11px] font-semibold text-ink-950">Request reversal as Sana (Ops)</button>
            )}
            {c.kind === "RECON_BREAK" && (
              <p className="mt-2 text-[11px] text-slate-400">Category {c.details?.category} - internal {c.details?.internal_minor != null ? pkr(c.details.internal_minor) : "none"} vs Raast {c.details?.external_minor != null ? pkr(c.details.external_minor) : "none"}. AI triage will suggest a cause; a human closes it.</p>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

const LEVEL_DOT: Record<string, string> = { info: "bg-paya-400", warn: "bg-amber-400", error: "bg-rose-400" };

export function FeedPanel({ feed, onOpen }: { feed: StreamMsg[]; onOpen: (ref: string) => void }) {
  return (
    <div className="space-y-1.5">
      <AnimatePresence initial={false}>
        {feed.map((m, i) => {
          const ref = msgRef(m);
          const lvl = m.kind === "event" ? "info" : m.level || "info";
          return (
            <motion.div key={`${m.event_id || m.at}-${i}-${m.phase || m.type}`} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-2 rounded-xl bg-white/[0.025] px-2.5 py-2 text-[11px] ring-1 ring-white/[0.04]">
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${m.kind === "event" ? "bg-sky-400" : LEVEL_DOT[lvl]}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`font-mono font-semibold ${m.kind === "event" ? "text-sky-300" : lvl === "error" ? "text-rose-300" : lvl === "warn" ? "text-amber-300" : "text-slate-200"}`}>
                    {m.kind === "event" ? m.type : `${m.node}.${m.phase}`}
                  </span>
                  <span className="ml-auto font-mono text-[9.5px] text-slate-600">{new Date(m.at || m.occurred_at || Date.now()).toLocaleTimeString()}</span>
                </div>
                {ref && <button onClick={() => onOpen(ref)} className="font-mono text-[10px] text-sky-400/80 hover:text-sky-300">{ref}</button>}
                {m.kind === "telemetry" && m.detail && Object.keys(m.detail).length > 0 && (
                  <p className="truncate font-mono text-[10px] text-slate-500">{JSON.stringify(m.detail)}</p>
                )}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export function Inspector({ txnRef, tick, onClose }: { txnRef: string; tick: number; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => { call<any>("auditor", `/v1/transactions/${txnRef}`).then((r) => setD(r.data)).catch(() => setD({ error: true })); }, [txnRef, tick]);
  return (
    <motion.div initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
      className="absolute inset-0 z-20 flex flex-col bg-ink-900/98 backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Transaction</p>
          <p className="font-mono text-sm">{txnRef}</p>
        </div>
        <button onClick={onClose} className="rounded-lg bg-white/5 p-1.5"><X size={16} /></button>
      </div>
      {!d ? <div className="grid flex-1 place-items-center"><Spinner /></div> : d.error ? <p className="p-4 text-sm text-rose-300">Not found</p> : (
        <div className="flex-1 space-y-4 overflow-y-auto p-4 scrollbar-thin">
          <div className="flex items-center justify-between">
            <span className="num text-2xl font-extrabold">{pkr(d.amount.minor)}</span>
            <StatusPill status={d.status} />
          </div>
          <p className="text-xs text-slate-400">{d.type} to {d.merchant || "-"} - recon: {d.recon_result || "pending"}</p>
          <Block title="References">
            {Object.entries(d.references).map(([k, v]) => <KV key={k} k={k} v={String(v ?? "-")} />)}
          </Block>
          <Block title="State history">
            {d.timeline.map((t: any, i: number) => (
              <div key={i} className="flex items-baseline gap-2 py-0.5 text-[11px]">
                <span className="font-mono text-slate-600">{new Date(t.at).toLocaleTimeString()}</span>
                <span className="font-mono text-slate-200">{t.from || "-"} &rarr; {t.to}</span>
                <span className="truncate text-slate-500">{t.reason} - {t.actor}</span>
              </div>
            ))}
          </Block>
          <Block title="Ledger (double entry)">
            {(d.ledger || []).map((j: any, i: number) => (
              <div key={i} className="mb-2 rounded-xl bg-black/30 p-2">
                <div className="flex justify-between text-[10px] text-slate-500"><span className="font-semibold text-slate-300">{j.posting_type}</span><span>{j.reason_code} - {j.initiated_via}{j.approved_by ? ` - approved ${j.approved_by}` : ""}</span></div>
                {j.entries.map((e: any, k: number) => (
                  <div key={k} className="flex justify-between font-mono text-[11px]">
                    <span className={e.direction === "D" ? "text-sky-300" : "pl-4 text-paya-300"}>{e.direction === "D" ? "Dr" : "Cr"} {e.account}</span>
                    <span className="num">{e.amount.pkr}</span>
                  </div>
                ))}
              </div>
            ))}
            {(!d.ledger || d.ledger.length === 0) && <p className="text-[11px] text-slate-500">No money has moved for this transaction.</p>}
          </Block>
          {d.screening?.length > 0 && <Block title="Risk decision">
            {d.screening.map((s: any, i: number) => <div key={i} className="text-[11px]"><b className={s.outcome === "PASS" ? "text-paya-300" : "text-amber-300"}>{s.outcome}</b> <span className="text-slate-400">{s.rules_fired.map((r: any) => r.rule).join(", ") || "no rules fired"} - {s.rule_version}</span></div>)}
          </Block>}
          {(d.cases?.length > 0 || d.approvals?.length > 0) && <Block title="Human decisions">
            {d.cases.map((c: any) => <p key={c.case_ref} className="text-[11px] text-slate-300">{c.case_ref} {c.kind} - {c.state}{c.resolution ? ` (${c.resolution} by ${c.resolved_by})` : ""}</p>)}
            {d.approvals.map((a: any) => <p key={a.id} className="text-[11px] text-slate-300">{a.action}: maker {a.maker} &rarr; checker {a.checker || "pending"}</p>)}
          </Block>}
          {d.notifications?.length > 0 && <Block title="Notifications sent">
            {d.notifications.map((n: any, i: number) => <p key={i} className="text-[11px] text-slate-400">[{n.recipient}] {n.body}</p>)}
          </Block>}
          {d.audit?.length > 0 && <Block title="Audit chain">
            {d.audit.map((a: any, i: number) => <p key={i} className="font-mono text-[10px] text-slate-500">{a.row_hash} {a.actor} {a.action} {a.outcome}</p>)}
          </Block>}
        </div>
      )}
    </motion.div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><h5 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{title}</h5>{children}</div>;
}
function KV({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-3 py-0.5 text-[11px]"><span className="text-slate-500">{k}</span><span className="truncate font-mono text-slate-300">{v}</span></div>;
}

