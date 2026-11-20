import { AnimatePresence, motion } from "framer-motion";
import { Check, Clock, RotateCcw, ShieldAlert, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Spinner } from "../../components/ui";
import { call, pkr } from "../../lib/api";
import { JOURNEY, STEP_LABEL } from "../../lib/status";
import { msgRef, useStream } from "../../lib/stream";

interface Detail {
  txn_ref: string; status: string; display_status: string; amount: { minor: number }; merchant: string;
  timeline: { from: string | null; to: string; at: string; reason: string }[];
  notifications: { body: string; at: string }[]; failure_reason: string | null;
  references: { rail_e2e_id: string | null; correlation_id: string };
}

const FINAL: Record<string, { icon: any; title: string; tone: string; ring: string }> = {
  SETTLED: { icon: Check, title: "Paid", tone: "text-paya-300", ring: "from-paya-300 to-paya-600" },
  RECONCILED: { icon: Check, title: "Paid", tone: "text-paya-300", ring: "from-paya-300 to-paya-600" },
  UNDER_REVIEW: { icon: ShieldAlert, title: "Under review", tone: "text-amber-400", ring: "from-amber-400 to-orange-600" },
  REVERSED: { icon: RotateCcw, title: "Returned to wallet", tone: "text-amber-400", ring: "from-amber-400 to-orange-600" },
  REJECTED: { icon: X, title: "Declined", tone: "text-rose-400", ring: "from-rose-400 to-rose-700" },
  FAILED: { icon: X, title: "Failed", tone: "text-rose-400", ring: "from-rose-400 to-rose-700" },
};

export default function TxnLive({ user }: { user: string }) {
  const { ref } = useParams();
  const nav = useNavigate();
  const [d, setD] = useState<Detail | null>(null);
  const load = useCallback(() => call<Detail>(user, `/v1/transactions/${ref}`).then((r) => setD(r.data)).catch(() => undefined), [user, ref]);
  useEffect(() => { load(); const t = setInterval(load, 2000); return () => clearInterval(t); }, [load]);
  useStream(user, (m) => { if (msgRef(m) === ref) load(); });

  if (!d) return <div className="grid h-60 place-items-center"><Spinner /></div>;
  const reached = new Set(d.timeline.map((t) => t.to).concat("CREATED"));
  const fin = FINAL[d.status];
  const inFlight = !fin;

  return (
    <div className="px-5 pb-10">
      <div className="mt-6 flex flex-col items-center text-center">
        <div className="relative grid h-36 w-36 place-items-center">
          <AnimatePresence mode="wait">
            {inFlight ? (
              <motion.div key="spin" exit={{ scale: 0.6, opacity: 0 }} className="absolute inset-0 rounded-full border-4 border-sky-400/20 border-t-sky-400 animate-spin" />
            ) : (
              <motion.div key="done" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 16 }}
                className={`absolute inset-0 rounded-full bg-gradient-to-br ${fin.ring} shadow-glow`} />
            )}
          </AnimatePresence>
          {fin ? <motion.div className="relative z-10" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.15 }}><fin.icon size={60} className="text-ink-950" strokeWidth={3} /></motion.div>
               : <Clock size={40} className="relative z-10 text-sky-400" />}
          {fin && (d.status === "SETTLED" || d.status === "RECONCILED") && <Burst />}
        </div>
        <h2 className={`mt-6 text-2xl font-extrabold ${fin ? fin.tone : "text-sky-400"}`}>{fin ? fin.title : d.display_status}</h2>
        <div className="num mt-1 text-4xl font-extrabold">{pkr(d.amount.minor)}</div>
        <p className="mt-1 text-sm text-slate-400">to {d.merchant}</p>
        <p className="mt-2 font-mono text-[11px] text-slate-500">{d.txn_ref}</p>
        {d.status === "UNDER_REVIEW" && <p className="mt-4 rounded-2xl bg-amber-400/10 p-3 text-xs text-amber-300 ring-1 ring-amber-400/30">A compliance officer is reviewing this. No money has left your wallet unless it says "Sent".</p>}
        {d.status === "REJECTED" && d.failure_reason && <p className="mt-4 rounded-2xl bg-rose-500/10 p-3 text-xs text-rose-300 ring-1 ring-rose-500/30">Reason: {d.failure_reason.replace(/_/g, " ").toLowerCase()}. No money was taken.</p>}
      </div>

      <div className="mt-8 rounded-3xl bg-ink-900/70 p-5 ring-1 ring-white/[0.06]">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">What Paya did</h3>
        <ol className="mt-4 space-y-0">
          {JOURNEY.map((s, i) => {
            const done = reached.has(s);
            const off = !done && (d.status === "REJECTED" || d.status === "REVERSED" || d.status === "UNDER_REVIEW");
            const at = d.timeline.find((t) => t.to === s)?.at;
            return (
              <li key={s} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <motion.span initial={false} animate={{ scale: done ? 1 : 0.8 }}
                    className={`grid h-6 w-6 place-items-center rounded-full ${done ? "bg-paya-400 text-ink-950" : "bg-ink-700 text-slate-500"}`}>
                    {done ? <Check size={14} strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                  </motion.span>
                  {i < JOURNEY.length - 1 && <span className={`w-px flex-1 ${done ? "bg-paya-400/50" : "bg-ink-700"}`} style={{ minHeight: 18 }} />}
                </div>
                <div className={`pb-4 ${off ? "opacity-30" : ""}`}>
                  <p className={`text-sm ${done ? "text-slate-100" : "text-slate-500"}`}>{STEP_LABEL[s]}</p>
                  {at && <p className="font-mono text-[10px] text-slate-500">{new Date(at).toLocaleTimeString()}</p>}
                </div>
              </li>
            );
          })}
          {["UNDER_REVIEW", "REVERSED", "REJECTED"].filter((s) => reached.has(s)).map((s) => (
            <li key={s} className="flex gap-3">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-amber-400 text-ink-950"><ShieldAlert size={13} /></span>
              <p className="pb-3 text-sm text-amber-300">{STEP_LABEL[s]}</p>
            </li>
          ))}
        </ol>
      </div>

      {d.notifications.length > 0 && (
        <div className="mt-4 space-y-2">
          {d.notifications.map((n, i) => <p key={i} className="rounded-2xl bg-white/5 p-3 text-xs text-slate-300">{n.body}</p>)}
        </div>
      )}
      <button onClick={() => nav("/app")} className="mt-6 w-full rounded-2xl bg-white/5 p-4 text-sm font-semibold ring-1 ring-white/10">Done</button>
    </div>
  );
}

function Burst() {
  return (
    <>
      {Array.from({ length: 14 }).map((_, i) => {
        const a = (i / 14) * Math.PI * 2;
        return (
          <motion.span key={i} className="absolute h-2 w-2 rounded-full bg-paya-300"
            initial={{ x: 0, y: 0, opacity: 1 }} animate={{ x: Math.cos(a) * 110, y: Math.sin(a) * 110, opacity: 0 }}
            transition={{ duration: 0.9, ease: "easeOut", delay: 0.1 }} />
        );
      })}
    </>
  );
}
