// Wallet home: the balance experience first, then the one thing people do most (pay), then recent activity.
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, ChevronRight, Eye, EyeOff, Info, Lock, QrCode, ShieldCheck, Store } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fadeUp, stagger } from "../ds/motion";
import { Card, Logo, Money, Skeleton, pkr } from "../ds/ui";
import { useApi } from "../lib/hooks";
import { useStream } from "../lib/stream";
import { ActivityRow, type WalletTxn } from "./Activity";

export interface Wallet {
  customer: { name: string; kyc_tier: number; kyc_status: string };
  ledger_balance: { minor: number }; available_balance: { minor: number };
  transactions: WalletTxn[];
}

const HIDE_KEY = "paya.hideBalance";
const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };

export function useWallet(user: string) {
  const qc = useQueryClient();
  const q = useApi<Wallet>(user, "/v1/wallet");
  useStream(user, (m) => { if (m.kind === "event") qc.invalidateQueries({ queryKey: [user, "/v1/wallet"] }); });
  return q;
}

export default function HomeScreen({ user }: { user: string }) {
  const nav = useNavigate();
  const { data: w, isLoading, isError, refetch } = useWallet(user);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; } });
  const toggle = () => { setHidden((h) => { try { localStorage.setItem(HIDE_KEY, h ? "0" : "1"); } catch { /* */ } return !h; }); };
  const reserved = w ? w.ledger_balance.minor - w.available_balance.minor : 0;
  const first = w?.customer.name.split(" ")[0];

  // Insight derived from the server's own transaction list (last 30), labelled as such.
  const now = new Date();
  const thisMonth = (w?.transactions || []).filter((t) => t.type === "PAYMENT" && ["SETTLED", "RECONCILED"].includes(t.status)
    && new Date(t.created_at).getMonth() === now.getMonth() && new Date(t.created_at).getFullYear() === now.getFullYear());
  const spent = thisMonth.reduce((a, t) => a + t.amount.minor, 0);
  const inProgress = (w?.transactions || []).filter((t) => ["CREATED", "VALIDATED", "AUTHORISED", "POSTED", "PENDING", "UNDER_REVIEW"].includes(t.status)).length;

  return (
    <motion.div variants={stagger(0.05)} initial="hidden" animate="show" className="safe-top px-5 pb-8">
      <motion.header variants={fadeUp} className="flex items-center justify-between pt-2">
        <Logo size={26} />
        <Link to="/app/account" aria-label="Account" className="grid h-9 w-9 place-items-center rounded-full bg-sunken font-display text-body-sm font-bold text-fg">{first?.[0] || "·"}</Link>
      </motion.header>

      <motion.h1 variants={fadeUp} className="mt-6 text-title-1 text-fg">{greeting()}{first ? `, ${first}` : ""}</motion.h1>

      {/* Balance */}
      <motion.section variants={fadeUp} aria-labelledby="bal-h" className="mt-4 rounded-xl bg-night p-5 text-night-fg shadow-e2">
        <div className="flex items-center justify-between">
          <h2 id="bal-h" className="text-label text-night-fg/75">Available to spend</h2>
          <button onClick={toggle} aria-pressed={hidden} aria-label={hidden ? "Show balance" : "Hide balance"}
            className="grid h-8 w-8 place-items-center rounded-full text-night-fg/80 hover:bg-white/10">{hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
        </div>
        <div className="mt-1 h-[3.25rem]">
          {isLoading ? <div className="h-10 w-40 animate-pulse rounded-md bg-white/10" /> : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.p key={hidden ? "h" : "v"} initial={{ opacity: 0, filter: "blur(6px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} exit={{ opacity: 0 }}
                className="num font-display text-amount-xl text-night-fg" aria-live="polite">
                {w ? (hidden ? "Rs ••••••" : pkr(w.available_balance.minor)) : "—"}
              </motion.p>
            </AnimatePresence>
          )}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-white/10 pt-3 text-caption">
          <div><dt className="text-night-fg/65">Ledger balance</dt><dd className="num mt-0.5 text-body-sm font-semibold">{w ? (hidden ? "••••" : pkr(w.ledger_balance.minor)) : "—"}</dd></div>
          <div><dt className="flex items-center gap-1 text-night-fg/65"><Lock className="h-3 w-3" aria-hidden />Reserved</dt><dd className="num mt-0.5 text-body-sm font-semibold">{w ? (hidden ? "••••" : pkr(reserved)) : "—"}</dd></div>
        </dl>
        <p className="mt-3 flex items-start gap-1.5 text-[12px] leading-snug text-night-fg/60"><Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />Available = ledger balance minus money reserved for payments still in progress.</p>
      </motion.section>

      {isError && <Card className="mt-3 p-3 text-body-sm text-fg-2">Couldn't load your wallet. <button className="font-semibold text-brand-accent underline" onClick={() => refetch()}>Try again</button></Card>}

      {/* Primary actions */}
      <motion.div variants={fadeUp} className="mt-4 grid grid-cols-2 gap-3">
        <button onClick={() => nav("/app/scan")} className="flex flex-col items-start gap-3 rounded-lg bg-brand p-4 text-left text-brand-fg shadow-e1 transition-transform active:scale-[0.98]">
          <QrCode className="h-6 w-6" aria-hidden /><span><span className="block text-body font-semibold">Scan to pay</span><span className="block text-caption">Raast QR at the counter</span></span>
        </button>
        <button onClick={() => nav("/app/scan#tills")} className="flex flex-col items-start gap-3 rounded-lg border border-line bg-surface p-4 text-left shadow-e1 transition-transform active:scale-[0.98]">
          <Store className="h-6 w-6 text-fg" aria-hidden /><span><span className="block text-body font-semibold text-fg">Pay a shop</span><span className="block text-caption text-fg-2">Pick a nearby till</span></span>
        </button>
      </motion.div>

      {/* Conversational banking */}
      <motion.button variants={fadeUp} onClick={() => nav("/app/assistant")} className="mt-3 flex w-full items-center gap-3 rounded-lg border border-line bg-surface p-3.5 text-left shadow-e1 hover:bg-hover">
        <span aria-hidden className="grid h-10 w-10 place-items-center rounded-full bg-night text-night-fg"><Bot className="h-5 w-5" /></span>
        <span className="min-w-0 flex-1"><span className="block text-body font-semibold text-fg">Ask Paya</span><span className="block truncate text-caption text-fg-2">"Did my payment go through?" · "mera balance kitna hai"</span></span>
        <ChevronRight className="h-4 w-4 text-fg-muted" aria-hidden />
      </motion.button>

      {/* Verification + insight */}
      <motion.div variants={fadeUp} className="mt-3 grid grid-cols-2 gap-3">
        <Card className="p-3.5">
          <p className="flex items-center gap-1.5 text-caption text-fg-2"><ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden />Verification</p>
          {w ? <p className="mt-1 text-body-sm font-semibold text-fg">{w.customer.kyc_status === "VERIFIED" ? `Verified · tier ${w.customer.kyc_tier}` : `Not verified (${w.customer.kyc_status.toLowerCase()})`}</p> : <Skeleton className="mt-1.5 h-4 w-24" />}
          <p className="text-caption text-fg-muted">{w?.customer.kyc_tier === 2 ? "Rs 500k per payment" : w?.customer.kyc_tier === 1 ? "Rs 25k per payment" : "Payments unavailable"}</p>
        </Card>
        <Card className="p-3.5">
          <p className="text-caption text-fg-2">Paid this month</p>
          {w ? <Money minor={spent} className="mt-1 block font-display text-title-3 text-fg" /> : <Skeleton className="mt-1.5 h-4 w-20" />}
          <p className="text-caption text-fg-muted">{thisMonth.length} confirmed{inProgress ? ` · ${inProgress} in progress` : ""}</p>
        </Card>
      </motion.div>

      {/* Activity */}
      <motion.section variants={fadeUp} aria-labelledby="act-h" className="mt-7">
        <div className="flex items-center justify-between">
          <h2 id="act-h" className="text-title-3 text-fg">Recent activity</h2>
          <Link to="/app/activity" className="flex items-center text-label text-brand-accent">See all <ChevronRight className="h-4 w-4" aria-hidden /></Link>
        </div>
        <Card className="mt-3 divide-y divide-line overflow-hidden">
          {isLoading && [0, 1, 2].map((i) => <div key={i} className="flex gap-3 p-3.5"><Skeleton className="h-10 w-10 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-20" /></div></div>)}
          {w && w.transactions.length === 0 && <p className="p-5 text-center text-body-sm text-fg-2">No activity yet. Your first payment will show here.</p>}
          {w?.transactions.slice(0, 5).map((t) => <ActivityRow key={t.txn_ref} t={t} />)}
        </Card>
      </motion.section>
    </motion.div>
  );
}
