import { motion } from "framer-motion";
import { ArrowUpRight, Eye, EyeOff, Lock, QrCode, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { StatusPill } from "../../components/ui";
import { call, pkr } from "../../lib/api";
import { useStream } from "../../lib/stream";

interface Wallet {
  customer: { name: string; kyc_tier: number; kyc_status: string };
  ledger_balance: { minor: number }; available_balance: { minor: number };
  transactions: { txn_ref: string; type: string; amount: { minor: number }; status: string; display_status: string; merchant: string | null; created_at: string }[];
}

export default function CustomerHome({ user }: { user: string }) {
  const nav = useNavigate();
  const [w, setW] = useState<Wallet | null>(null);
  const [hide, setHide] = useState(false);
  const load = useCallback(() => call<Wallet>(user, "/v1/wallet").then((r) => setW(r.data)).catch(() => undefined), [user]);
  useEffect(() => { load(); }, [load]);
  useStream(user, (m) => { if (m.kind === "event") load(); });

  const held = w ? w.ledger_balance.minor - w.available_balance.minor : 0;
  return (
    <div className="px-5 pb-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="relative mt-2 overflow-hidden rounded-[28px] bg-gradient-to-br from-paya-500 via-paya-600 to-emerald-900 p-6 text-ink-950">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/20 blur-2xl" />
        <div className="flex items-center justify-between text-xs font-semibold opacity-80">
          <span>Available balance</span>
          <button onClick={() => setHide(!hide)} className="flex items-center gap-1">{hide ? <EyeOff size={14} /> : <Eye size={14} />}</button>
        </div>
        <div className="num mt-2 text-4xl font-extrabold tracking-tight">{w ? (hide ? "Rs •••••" : pkr(w.available_balance.minor)) : "-"}</div>
        <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold">
          <span className="flex items-center gap-1 rounded-full bg-ink-950/15 px-2.5 py-1"><ShieldCheck size={12} /> KYC {w?.customer.kyc_status.toLowerCase()} - Tier {w?.customer.kyc_tier}</span>
          {held > 0 && <span className="flex items-center gap-1 rounded-full bg-ink-950/15 px-2.5 py-1"><Lock size={12} /> {pkr(held)} reserved</span>}
        </div>
        <p className="mt-3 text-[11px] opacity-70">Ledger balance {w ? pkr(w.ledger_balance.minor) : "-"} - available = ledger minus reserved funds</p>
      </motion.div>

      <motion.button whileTap={{ scale: 0.98 }} onClick={() => nav("/app/scan")}
        className="card mt-4 flex w-full items-center gap-4 p-4 text-left">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-paya-400/15 text-paya-300"><QrCode size={22} /></span>
        <span className="flex-1">
          <span className="block font-semibold">Scan to pay</span>
          <span className="block text-xs text-slate-400">Any Raast QR at the counter</span>
        </span>
        <ArrowUpRight size={18} className="text-slate-500" />
      </motion.button>

      <h3 className="mt-7 text-sm font-semibold text-slate-300">Activity</h3>
      <div className="mt-3 space-y-2">
        {w?.transactions.length === 0 && <p className="text-sm text-slate-500">No payments yet.</p>}
        {w?.transactions.map((t) => (
          <motion.button layout key={t.txn_ref} onClick={() => t.type === "PAYMENT" && nav(`/app/txn/${t.txn_ref}`)}
            className="flex w-full items-center gap-3 rounded-2xl bg-ink-900/60 p-3 text-left ring-1 ring-white/[0.05]">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/5 text-sm font-bold text-slate-300">
              {(t.merchant || (t.type === "TOPUP" ? "+" : "R"))[0]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{t.merchant || (t.type === "TOPUP" ? "Wallet top-up" : t.type.toLowerCase())}</span>
              <span className="block font-mono text-[10px] text-slate-500">{t.txn_ref}</span>
            </span>
            <span className="text-right">
              <span className={`num block text-sm font-semibold ${t.type === "PAYMENT" ? "" : "text-paya-300"}`}>{t.type === "PAYMENT" ? "-" : "+"}{pkr(t.amount.minor)}</span>
              {t.type === "PAYMENT" && <StatusPill status={t.status} label={t.display_status} />}
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
