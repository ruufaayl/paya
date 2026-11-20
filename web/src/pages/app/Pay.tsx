import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { ChevronsRight, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Spinner } from "../../components/ui";
import { ApiError, call, newIdempotencyKey, pkr } from "../../lib/api";

interface PR { id: string; order_ref: string; amount: { minor: number }; status: string; merchant: { name: string; category: string; alias: string }; latest_payment: { txn_ref: string } | null }

export default function Pay({ user }: { user: string }) {
  const { prId } = useParams();
  const nav = useNavigate();
  const [pr, setPr] = useState<PR | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One idempotency key per payment intent: a retry after a dropped connection reuses it, so it can never debit twice.
  const key = useMemo(() => newIdempotencyKey(), [prId]);

  useEffect(() => {
    call<PR>(user, `/v1/payment-requests/${prId}`).then((r) => setPr(r.data)).catch((e) => setError(e.message));
  }, [user, prId]);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await call<{ txn_ref: string }>(user, "/v1/payments", { method: "POST", idempotencyKey: key, body: JSON.stringify({ payment_request_id: prId }) });
      nav(`/app/txn/${r.data.txn_ref}`, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === "PAYMENT_ALREADY_IN_PROGRESS" && e.body?.error?.txn_ref) {
        nav(`/app/txn/${e.body.error.txn_ref}`, { replace: true });
        return;
      }
      setError(e instanceof ApiError ? e.message : "Network problem. Your payment is safe to retry - it will not be charged twice.");
      setBusy(false);
    }
  };

  if (!pr) return <div className="grid h-60 place-items-center text-slate-500">{error || <Spinner />}</div>;
  const closed = pr.status !== "OPEN";

  return (
    <div className="flex min-h-full flex-col px-5 pb-8">
      <div className="mt-6 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-gradient-to-br from-paya-300 to-paya-700 text-2xl font-extrabold text-ink-950">{pr.merchant.name[0]}</div>
        <p className="mt-3 text-sm text-slate-400">Paying</p>
        <h2 className="text-xl font-bold">{pr.merchant.name}</h2>
        <p className="font-mono text-[11px] text-slate-500">{pr.merchant.alias} - {pr.order_ref}</p>
        <div className="num mt-8 text-5xl font-extrabold tracking-tight">{pkr(pr.amount.minor)}</div>
      </div>

      <div className="mt-8 space-y-2 rounded-3xl bg-ink-900/70 p-4 text-xs text-slate-400 ring-1 ring-white/[0.06]">
        <Row k="Rail" v="Raast P2M (simulated)" />
        <Row k="Fee to you" v="Rs 0" />
        <Row k="Safe retry" v={<span className="font-mono">{key.slice(0, 18)}...</span>} />
        <p className="flex items-start gap-2 pt-1 text-paya-300/80"><ShieldCheck size={14} className="mt-0.5 shrink-0" /> The shop sees "Paid" only after Raast confirms - never from a screenshot.</p>
      </div>

      <div className="flex-1" />
      {error && <p className="mb-3 rounded-2xl bg-rose-500/10 p-3 text-sm text-rose-300 ring-1 ring-rose-500/30">{error}</p>}
      {closed ? (
        <button onClick={() => pr.latest_payment && nav(`/app/txn/${pr.latest_payment.txn_ref}`)} className="rounded-2xl bg-white/5 p-4 text-sm text-slate-300 ring-1 ring-white/10">
          This request is {pr.status.toLowerCase()}{pr.latest_payment ? " - view payment" : ""}
        </button>
      ) : (
        <SlideToPay busy={busy} onConfirm={submit} />
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between"><span>{k}</span><span className="text-slate-200">{v}</span></div>;
}

function SlideToPay({ onConfirm, busy }: { onConfirm: () => void; busy: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const [max, setMax] = useState(260);
  useEffect(() => { if (track.current) setMax(track.current.offsetWidth - 64); }, []);
  const fill = useTransform(x, [0, max], ["0%", "100%"]);
  const label = useTransform(x, [0, max * 0.6], [1, 0]);
  return (
    <div ref={track} className="relative h-16 overflow-hidden rounded-[22px] bg-ink-850 ring-1 ring-white/10">
      <motion.div style={{ width: fill }} className="absolute inset-y-0 left-0 bg-paya-500/25" />
      <motion.span style={{ opacity: label }} className="absolute inset-0 grid place-items-center text-sm font-semibold text-slate-300">
        {busy ? "Paying..." : "Slide to pay"}
      </motion.span>
      <motion.div drag={busy ? false : "x"} dragConstraints={{ left: 0, right: max }} dragElastic={0} style={{ x }}
        onDragEnd={() => {
          if (x.get() > max * 0.85) { animate(x, max, { duration: 0.15 }); onConfirm(); }
          else animate(x, 0, { type: "spring", stiffness: 400, damping: 30 });
        }}
        className="absolute left-1 top-1 grid h-14 w-14 cursor-grab place-items-center rounded-[18px] bg-paya-400 text-ink-950 shadow-glow active:cursor-grabbing">
        {busy ? <Spinner className="h-5 w-5" /> : <ChevronsRight />}
      </motion.div>
    </div>
  );
}
