// Review and authorise. The amount comes from the merchant's payment request on the server; the customer
// confirms it. One idempotency key per intent, kept for this request, so a retry can never charge twice.
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { ArrowLeft, ChevronsRight, Info, Lock, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Card, IconButton, KV, Money, Skeleton, pkr } from "../ds/ui";
import { ApiError, call, newIdempotencyKey } from "../lib/api";
import { useApi } from "../lib/hooks";
import { useWallet } from "./Home";

interface PR { id: string; order_ref: string; amount: { minor: number }; status: string; expires_at: string; merchant: { name: string; category: string; alias: string }; latest_payment: { txn_ref: string; status: string } | null }

function intentKey(prId: string) {
  // Survives a refresh: the same payment request always reuses the same key on this device.
  const k = `paya.intent.${prId}`;
  try { const v = sessionStorage.getItem(k); if (v) return v; const n = newIdempotencyKey(); sessionStorage.setItem(k, n); return n; }
  catch { return newIdempotencyKey(); }
}

export default function Review({ user }: { user: string }) {
  const { prId = "" } = useParams();
  const nav = useNavigate();
  const pr = useApi<PR>(user, `/v1/payment-requests/${prId}`);
  const w = useWallet(user);
  const key = useMemo(() => intentKey(prId), [prId]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await call<{ txn_ref: string }>(user, "/v1/payments", { method: "POST", idempotencyKey: key, body: JSON.stringify({ payment_request_id: prId }) });
      nav(`/app/txn/${r.data.txn_ref}`, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === "PAYMENT_ALREADY_IN_PROGRESS" && e.body?.error?.txn_ref) { nav(`/app/txn/${e.body.error.txn_ref}`, { replace: true }); return; }
      setErr(e instanceof ApiError ? e.message : "The connection dropped. It's safe to try again: the same request can never be charged twice.");
      setBusy(false);
    }
  };

  const p = pr.data;
  const avail = w.data?.available_balance.minor;
  const short = p && avail != null && avail < p.amount.minor;
  const closed = p && p.status !== "OPEN";

  return (
    <div className="safe-top flex min-h-full flex-col px-5 pb-6">
      <div className="flex items-center gap-2 pt-2">
        <IconButton label="Back" onClick={() => nav(-1)}><ArrowLeft className="h-5 w-5" /></IconButton>
        <h1 className="text-title-2 text-fg">Review payment</h1>
      </div>
      {pr.isError && <div className="mt-6"><Alert tone="danger" title="Couldn't load this payment request">It may have expired or belong to another shop.</Alert></div>}

      <div className="mt-8 flex flex-col items-center text-center">
        {p ? <span aria-hidden className="grid h-16 w-16 place-items-center rounded-2xl bg-night font-display text-title-1 text-night-fg">{p.merchant.name[0]}</span> : <Skeleton className="h-16 w-16 rounded-2xl" />}
        <p className="mt-3 text-body-sm text-fg-2">You're paying</p>
        <h2 className="text-title-2 text-fg">{p?.merchant.name || <Skeleton className="mx-auto h-6 w-32" />}</h2>
        <p className="ref text-[12px] text-fg-muted">{p?.merchant.alias}</p>
        <div className="mt-6">{p ? <Money minor={p.amount.minor} className="font-display text-amount-xl text-fg" /> : <Skeleton className="h-12 w-44" />}</div>
        <p className="mt-1 text-caption text-fg-2">Amount set by the shop for order <span className="ref">{p?.order_ref}</span></p>
      </div>

      <Card className="mt-7 px-4 py-2">
        <dl>
          <KV k="From" v="Your Rupay wallet" />
          <KV k="Available now" v={avail != null ? pkr(avail) : "—"} />
          <KV k="After this payment" v={avail != null && p ? pkr(avail - p.amount.minor) : "—"} />
          <KV k="Fee" v="Rs 0" />
          <KV k="Network" v="Raast P2M (simulated)" />
          <KV k="Request expires" v={p ? new Date(p.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"} />
        </dl>
      </Card>
      <p className="mt-3 flex items-start gap-2 text-caption text-fg-2"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-accent" aria-hidden />
        The shop's till shows "Paid" only after Raast confirms the transfer, never from a screenshot.</p>

      <div className="flex-1" />
      <div className="mt-6 space-y-3">
        {err && <Alert tone="danger" title="Payment not sent">{err}</Alert>}
        {short && <Alert tone="warning" title="Not enough available balance" icon={<Info className="h-4 w-4" />}>You need {pkr(p!.amount.minor - avail!)} more. Money reserved for other payments isn't available.</Alert>}
        {closed ? (
          <Button size="lg" variant="secondary" block onClick={() => p?.latest_payment && nav(`/app/txn/${p.latest_payment.txn_ref}`)}>
            This request is {p!.status.toLowerCase()}{p!.latest_payment ? " · view payment" : ""}
          </Button>
        ) : (
          <>
            <SlideToPay disabled={!p || short || busy} busy={busy} amount={p ? pkr(p.amount.minor) : ""} onConfirm={submit} />
            <p className="flex items-center justify-center gap-1.5 text-caption text-fg-muted"><Lock className="h-3 w-3" aria-hidden />Slide, or focus the control and press Enter, to authorise</p>
          </>
        )}
      </div>
    </div>
  );
}

/** Slide to authorise, with a keyboard/switch alternative (Enter or Space). */
export function SlideToPay({ onConfirm, busy, disabled, amount, verb = "pay" }: { onConfirm: () => void; busy: boolean; disabled?: boolean; amount: string; verb?: string }) {
  const track = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const [max, setMax] = useState(260);
  useEffect(() => { const m = () => track.current && setMax(track.current.offsetWidth - 60); m(); window.addEventListener("resize", m); return () => window.removeEventListener("resize", m); }, []);
  const fill = useTransform(x, [0, max], ["0%", "100%"]);
  const label = useTransform(x, [0, max * 0.6], [1, 0]);
  const fire = () => { animate(x, max, { duration: 0.15 }); onConfirm(); };
  return (
    <div ref={track} className={`relative h-[60px] overflow-hidden rounded-lg border border-line bg-sunken ${disabled && !busy ? "opacity-50" : ""}`}>
      <motion.div style={{ width: fill }} className="absolute inset-y-0 left-0 bg-brand/15" />
      <motion.span style={{ opacity: label }} className="pointer-events-none absolute inset-0 grid place-items-center text-body font-semibold text-fg-2">
        {busy ? "Sending…" : `Slide to ${verb} ${amount}`}
      </motion.span>
      <motion.button type="button" role="slider" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0} aria-label={`Authorise ${verb === "pay" ? "payment" : "transfer"} of ${amount}`}
        disabled={disabled || busy} drag={disabled || busy ? false : "x"} dragConstraints={{ left: 0, right: max }} dragElastic={0} style={{ x }}
        onKeyDown={(e) => { if (!disabled && !busy && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); fire(); } }}
        onDragEnd={() => { if (x.get() > max * 0.85) fire(); else animate(x, 0, { type: "spring", stiffness: 420, damping: 32 }); }}
        className="absolute left-1 top-1 grid h-[50px] w-[52px] cursor-grab place-items-center rounded-md bg-brand text-brand-fg shadow-e1 active:cursor-grabbing">
        {busy ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <ChevronsRight className="h-6 w-6" />}
      </motion.button>
    </div>
  );
}
