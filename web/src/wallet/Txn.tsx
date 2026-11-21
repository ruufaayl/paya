// Transaction result + detail + receipt. The headline state is the SERVER's status. A payment that is still
// pending never animates into success; the confirmation mark appears only once the ledger says SETTLED.
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, Clock3, Copy, Printer, Receipt, RotateCcw, UserRoundSearch, X } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { spring } from "../ds/motion";
import { Dialog } from "../ds/overlay";
import { JOURNEY, STEP_TEXT, TONE_CLASS, paymentMeta } from "../ds/status";
import { Timeline, type TimelineItem } from "../ds/timeline";
import { Alert, Button, Card, IconButton, KV, Logo, Money, Ref, Skeleton, StatusBadge, cx } from "../ds/ui";
import { useToast } from "../ds/toast";
import { fmtDateTime, useApi } from "../lib/hooks";
import { msgRef, useStream } from "../lib/stream";

interface Detail {
  txn_ref: string; type: string; status: string; display_status: string; amount: { minor: number }; merchant: string | null;
  created_at: string; updated_at: string; failure_reason: string | null; recon_result: string | null;
  timeline: { from: string | null; to: string; at: string; reason: string; actor: string }[];
  references: { txn_id: string; correlation_id: string; rail: string; rail_e2e_id: string | null };
  related: { txn_ref: string; type: string; status: string }[];
  notifications: { body: string; at: string }[];
  money_trail: { posting_type: string; at: string; description: string; journal_ref: string }[];
  rail_status: { network: string; e2e_id: string | null; sent: boolean; attempts: number; confirmed_at: string | null };
}

const HEADLINE: Record<string, { title: string; icon: any }> = {
  SETTLED: { title: "Paid", icon: Check }, RECONCILED: { title: "Paid", icon: Check },
  UNDER_REVIEW: { title: "Under review", icon: UserRoundSearch }, REVERSED: { title: "Returned to your wallet", icon: RotateCcw },
  REJECTED: { title: "Declined", icon: X }, FAILED: { title: "Failed", icon: X }, EXPIRED: { title: "Expired", icon: X },
};

export default function Txn({ user }: { user: string }) {
  const { ref = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [receipt, setReceipt] = useState(false);
  const q = useApi<Detail>(user, `/v1/transactions/${ref}`, {
    refetchInterval: (query) => (query.state.data && paymentMeta(query.state.data.status).final ? false : 2000),
  });
  useStream(user, (m) => { if (msgRef(m) === ref) qc.invalidateQueries({ queryKey: [user, `/v1/transactions/${ref}`] }); });
  const d = q.data;

  if (q.isError) return <div className="safe-top p-5"><Alert tone="danger" title="Payment not found">We couldn't find this payment in your wallet.</Alert><Button className="mt-4" variant="secondary" onClick={() => nav("/app")}>Back home</Button></div>;
  if (!d) return <div className="safe-top space-y-4 p-5 pt-16"><Skeleton className="mx-auto h-24 w-24 rounded-full" /><Skeleton className="mx-auto h-8 w-48" /><Skeleton className="h-40 w-full" /></div>;

  const meta = paymentMeta(d.status);
  const head = HEADLINE[d.status];
  const paid = d.status === "SETTLED" || d.status === "RECONCILED";
  const reached = new Map(d.timeline.map((t) => [t.to, t.at]));
  reached.set("CREATED", d.created_at);
  const off = ["REJECTED", "REVERSED", "FAILED", "EXPIRED"].includes(d.status);
  const items: TimelineItem[] = JOURNEY.map((s) => {
    const at = reached.get(s);
    const m = paymentMeta(s);
    const current = !at && !off && s === JOURNEY.find((x) => !reached.has(x));
    return { id: s, title: STEP_TEXT[s].title, body: at || current ? STEP_TEXT[s].body : undefined, at, tone: at ? m.tone : "processing",
      icon: at ? <Check className="h-3.5 w-3.5" /> : current ? <Clock3 className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />,
      state: at ? "done" : off ? "skipped" : current ? "current" : "upcoming" };
  });
  for (const s of ["UNDER_REVIEW", "REVERSED", "REJECTED", "FAILED"]) {
    if (reached.has(s)) { const m = paymentMeta(s); items.push({ id: s, title: STEP_TEXT[s].title, body: STEP_TEXT[s].body, at: reached.get(s), tone: m.tone, icon: <m.icon className="h-3.5 w-3.5" />, state: "done" }); }
  }
  const copy = (v: string) => { navigator.clipboard?.writeText(v).then(() => toast.ok("Copied", v)).catch(() => undefined); };

  return (
    <div className="safe-top px-5 pb-8">
      <div className="flex items-center gap-2 pt-2">
        <IconButton label="Back to home" onClick={() => nav("/app")}><ArrowLeft className="h-5 w-5" /></IconButton>
        <span className="text-body-sm text-fg-2">Payment</span>
      </div>

      <section aria-live="polite" className="mt-6 flex flex-col items-center text-center">
        <div className="relative grid h-24 w-24 place-items-center">
          <AnimatePresence mode="wait">
            {head ? (
              <motion.div key={d.status} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.settle}
                className={cx("grid h-24 w-24 place-items-center rounded-full border-2", TONE_CLASS[meta.tone].soft, TONE_CLASS[meta.tone].line, TONE_CLASS[meta.tone].text)}>
                <head.icon className="h-11 w-11" strokeWidth={2.6} aria-hidden />
              </motion.div>
            ) : (
              <motion.div key="wait" exit={{ opacity: 0 }} className="grid h-24 w-24 place-items-center rounded-full border-2 border-processing-line bg-processing-soft text-processing">
                <svg className="absolute h-24 w-24 animate-spin" viewBox="0 0 100 100" aria-hidden><circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray="60 230" strokeLinecap="round" /></svg>
                <Clock3 className="h-9 w-9" aria-hidden />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <h1 className={cx("mt-5 font-display text-title-1", head ? TONE_CLASS[meta.tone].text : "text-processing")}>{head ? head.title : "Processing"}</h1>
        <Money minor={d.amount.minor} className="mt-1 font-display text-amount text-fg" />
        <p className="text-body-sm text-fg-2">to {d.merchant}</p>
        <div className="mt-3"><StatusBadge meta={meta} /></div>
        {!head && <p className="mt-3 max-w-xs text-body-sm text-fg-2">{d.status === "PENDING" ? "Sent over Raast. We'll show \"Paid\" only when the rail confirms it. You can leave this screen; it's safe." : "Working on it…"}</p>}
        {d.status === "UNDER_REVIEW" && <div className="mt-4 w-full text-left"><Alert tone="review" title="A person is reviewing this payment">Your money is reserved, not sent. You'll see the outcome here.</Alert></div>}
        {d.status === "REJECTED" && <div className="mt-4 w-full text-left"><Alert tone="danger" title="No money left your wallet">{d.failure_reason ? `Reason: ${d.failure_reason.replace(/_/g, " ").toLowerCase()}.` : ""}</Alert></div>}
        {d.status === "REVERSED" && <div className="mt-4 w-full text-left"><Alert tone="warning" title="The full amount is back in your wallet">Returned with a compensating ledger entry. The original payment stays on record.</Alert></div>}
      </section>

      {paid && <div className="mt-6"><Button variant="secondary" size="lg" block icon={<Receipt className="h-4 w-4" />} onClick={() => setReceipt(true)}>View receipt</Button></div>}

      <Card as="section" aria-labelledby="tl-h" className="mt-6 p-4">
        <h2 id="tl-h" className="mb-4 text-title-3 text-fg">What happened</h2>
        <Timeline label="Payment progress" items={items} />
      </Card>

      {d.money_trail.length > 0 && (
        <Card as="section" aria-labelledby="mt-h" className="mt-3 p-4">
          <h2 id="mt-h" className="text-title-3 text-fg">Where your money went</h2>
          <p className="text-caption text-fg-2">Straight from Paya's double-entry ledger.</p>
          <ul className="mt-3 space-y-2">
            {d.money_trail.map((m) => (
              <li key={m.journal_ref} className="flex items-start justify-between gap-3 text-body-sm">
                <span className="text-fg">{m.description}<span className="block text-caption text-fg-muted">Journal <span className="ref">{m.journal_ref}</span> · {fmtDateTime(m.at)}</span></span>
                <Money minor={m.posting_type === "REVERSAL" ? d.amount.minor : -d.amount.minor} sign className="font-semibold text-fg" />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card as="section" aria-labelledby="ref-h" className="mt-3 px-4 py-3">
        <h2 id="ref-h" className="sr-only">References</h2>
        <dl>
          <KV k="Payment reference" v={<button className="inline-flex items-center gap-1" onClick={() => copy(d.txn_ref)}><Ref className="text-fg">{d.txn_ref}</Ref><Copy className="h-3.5 w-3.5 text-fg-muted" aria-label="Copy" /></button>} />
          <KV k="Network" v={d.rail_status.network} />
          <KV k="Raast end-to-end id" v={d.rail_status.e2e_id ? <Ref>{d.rail_status.e2e_id}</Ref> : "Not sent yet"} />
          <KV k="Rail confirmation" v={d.rail_status.confirmed_at ? fmtDateTime(d.rail_status.confirmed_at) : d.rail_status.sent ? "Waiting" : "—"} />
          <KV k="Reconciliation" v={d.status === "RECONCILED" ? "Matched with the Raast file" : paid ? "Due in the next file" : "—"} />
          <KV k="Started" v={fmtDateTime(d.created_at)} />
        </dl>
      </Card>

      <Button variant="ghost" block className="mt-4" onClick={() => nav("/app")}>Done</Button>

      <Dialog open={receipt} onClose={() => setReceipt(false)} title="Receipt" description="Issued from the ledger after Raast confirmed the payment." width={400}
        footer={<><Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print</Button><Button onClick={() => setReceipt(false)}>Close</Button></>}>
        <div className="rounded-lg border border-dashed border-line-strong p-4">
          <div className="flex items-center justify-between"><Logo size={22} /><StatusBadge meta={meta} size="sm" /></div>
          <Money minor={d.amount.minor} className="mt-4 block font-display text-amount text-fg" />
          <p className="text-body-sm text-fg-2">paid to {d.merchant}</p>
          <dl className="mt-3 border-t border-line pt-2">
            <KV k="Date" v={fmtDateTime(d.rail_status.confirmed_at || d.updated_at)} />
            <KV k="Reference" v={d.txn_ref} mono />
            <KV k="Raast E2E" v={d.rail_status.e2e_id || "—"} mono />
            <KV k="Fee" v="Rs 0" />
          </dl>
          <p className="mt-3 text-caption text-fg-muted">Synthetic demo receipt. Simulated Raast rail; no real money moved.</p>
        </div>
      </Dialog>
    </div>
  );
}
