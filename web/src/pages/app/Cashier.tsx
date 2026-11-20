import { AnimatePresence, motion } from "framer-motion";
import { Check, Delete, Loader2, RotateCcw, ShieldAlert, Volume2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";
import { StatusPill } from "../../components/ui";
import { ApiError, call, pkr } from "../../lib/api";
import { speak, useStream } from "../../lib/stream";

interface PR { id: string; order_ref: string; amount: { minor: number }; status: string; qr_payload: string; merchant: { name: string }; latest_payment: { txn_ref: string; status: string; display_status: string } | null }
interface Sale { txn_ref: string; order_ref: string; amount: { minor: number }; status: string; display_status: string; paid: boolean; created_at: string }

export default function Cashier({ user }: { user: string }) {
  const [digits, setDigits] = useState("");
  const [pr, setPr] = useState<PR | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const announced = useRef<string | null>(null);

  const loadSales = useCallback(() => call<Sale[]>(user, "/v1/merchant/transactions").then((r) => setSales(r.data)).catch(() => undefined), [user]);
  const refreshPr = useCallback(() => {
    if (!pr) return;
    call<PR>(user, `/v1/payment-requests/${pr.id}`).then((r) => setPr(r.data)).catch(() => undefined);
  }, [user, pr?.id]);
  useEffect(() => { loadSales(); }, [loadSales]);
  useEffect(() => { if (!pr) return; const t = setInterval(refreshPr, 2000); return () => clearInterval(t); }, [pr?.id, refreshPr]);
  useStream(user, (m) => { if (m.kind === "event") { loadSales(); refreshPr(); } });

  const status = pr?.latest_payment?.status;
  const paid = status === "SETTLED" || status === "RECONCILED";
  useEffect(() => {
    if (paid && pr && announced.current !== pr.id) {
      announced.current = pr.id;
      speak(`Rupees ${Math.round(pr.amount.minor / 100).toLocaleString("en-US")} received. Payment pakka.`);
    }
  }, [paid, pr]);

  useEffect(() => { document.getElementById("app-scroll")?.scrollTo({ top: 0, behavior: "smooth" }); }, [pr?.id, paid]);

  const amountMinor = Math.round(Number(digits || "0") * 100);
  const key = (k: string) => setDigits((d) => (k === "del" ? d.slice(0, -1) : (d + k).replace(/^0+(?=\d)/, "").slice(0, 7)));
  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await call<PR>(user, "/v1/payment-requests", { method: "POST", body: JSON.stringify({ amount_minor: amountMinor, order_ref: `ORD-${Date.now().toString(36).toUpperCase()}` }) });
      setPr(r.data); announced.current = null;
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Cannot reach Paya server"); }
    finally { setBusy(false); }
  };
  const reset = () => { setPr(null); setDigits(""); loadSales(); };

  return (
    <div className="px-5 pb-8">
      <AnimatePresence mode="wait">
        {!pr ? (
          <motion.div key="keypad" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <p className="mt-4 text-center text-sm text-slate-400">New sale</p>
            <div className="num mt-2 text-center text-6xl font-extrabold tracking-tight">Rs {Number(digits || "0").toLocaleString("en-PK")}</div>
            <div className="mt-8 grid grid-cols-3 gap-3">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "del"].map((k) => (
                <motion.button key={k} whileTap={{ scale: 0.92 }} onClick={() => key(k)}
                  className="grid h-16 place-items-center rounded-2xl bg-ink-900 text-2xl font-semibold ring-1 ring-white/[0.06]">
                  {k === "del" ? <Delete size={22} /> : k}
                </motion.button>
              ))}
            </div>
            {err && <p className="mt-4 rounded-2xl bg-rose-500/10 p-3 text-sm text-rose-300">{err}</p>}
            <motion.button whileTap={{ scale: 0.98 }} disabled={amountMinor <= 0 || busy} onClick={create}
              className="mt-5 flex h-16 w-full items-center justify-center gap-2 rounded-[22px] bg-paya-400 text-lg font-bold text-ink-950 disabled:opacity-30">
              {busy ? <Loader2 className="animate-spin" /> : "Show Raast QR"}
            </motion.button>
          </motion.div>
        ) : paid ? (
          <motion.div key="paid" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mt-6 flex flex-col items-center text-center">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 220, damping: 12 }}
              className="grid h-44 w-44 place-items-center rounded-full bg-gradient-to-br from-paya-300 to-paya-600 shadow-glow">
              <Check size={96} strokeWidth={3} className="text-ink-950" />
            </motion.div>
            <h2 className="mt-6 text-5xl font-black tracking-tight text-paya-300">PAID</h2>
            <div className="num mt-2 text-4xl font-extrabold">{pkr(pr.amount.minor)}</div>
            <p className="mt-2 text-sm text-slate-400">Confirmed by Raast and posted to the ledger.</p>
            <p className="font-mono text-[11px] text-slate-500">{pr.latest_payment?.txn_ref} - {pr.order_ref}</p>
            <button onClick={() => speak(`Rupees ${Math.round(pr.amount.minor / 100)} received`)} className="mt-4 flex items-center gap-2 text-xs text-slate-400"><Volume2 size={14} /> Replay announcement</button>
            <button onClick={reset} className="mt-8 w-full rounded-[22px] bg-white/5 p-5 text-lg font-semibold ring-1 ring-white/10">New sale</button>
          </motion.div>
        ) : (
          <motion.div key="qr" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-2 flex flex-col items-center text-center">
            <p className="text-sm text-slate-400">{pr.merchant.name} - {pr.order_ref}</p>
            <div className="num text-5xl font-extrabold">{pkr(pr.amount.minor)}</div>
            <motion.div layout className="relative mt-6 rounded-[28px] bg-white p-5">
              <QRCodeSVG value={pr.qr_payload} size={230} bgColor="#ffffff" fgColor="#05070A" level="M" />
              {status && <div className="absolute inset-0 grid place-items-center rounded-[28px] bg-white/85 backdrop-blur-sm">
                <div className="text-ink-950">
                  {status === "UNDER_REVIEW" ? <ShieldAlert className="mx-auto text-amber-500" size={48} /> : status === "REVERSED" || status === "REJECTED" ? <RotateCcw className="mx-auto text-rose-500" size={44} /> : <Loader2 className="mx-auto animate-spin text-sky-500" size={48} />}
                  <p className="mt-2 font-bold">{pr.latest_payment?.display_status}</p>
                </div>
              </div>}
            </motion.div>
            <p className="mt-5 max-w-xs text-sm text-slate-400">
              {status ? "Customer is paying. Do not hand over goods until this screen says PAID." : "Ask the customer to scan with any Raast-enabled app."}
            </p>
            {(status === "REVERSED" || status === "REJECTED") && <p className="mt-3 rounded-2xl bg-rose-500/10 p-3 text-sm text-rose-300">Payment did not go through. Ask for another payment method.</p>}
            <button onClick={reset} className="mt-6 text-sm text-slate-400 underline-offset-4 hover:underline">Cancel sale</button>
          </motion.div>
        )}
      </AnimatePresence>

      <h3 className="mt-10 text-sm font-semibold text-slate-300">Today at this till</h3>
      <div className="mt-3 space-y-2">
        {sales.slice(0, 8).map((s) => (
          <div key={s.txn_ref} className="flex items-center gap-3 rounded-2xl bg-ink-900/60 p-3 ring-1 ring-white/[0.05]">
            <span className="flex-1">
              <span className="num block text-sm font-semibold">{pkr(s.amount.minor)}</span>
              <span className="block font-mono text-[10px] text-slate-500">{s.order_ref}</span>
            </span>
            <StatusPill status={s.status} label={s.paid ? "Paid" : s.display_status} />
          </div>
        ))}
      </div>
    </div>
  );
}
