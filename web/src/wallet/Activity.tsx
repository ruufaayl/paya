// Activity: every wallet movement, grouped by day, with the server's status in words and an icon.
import { motion } from "framer-motion";
import { ArrowDownLeft, ArrowUpRight, PiggyBank, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { paymentMeta } from "../ds/status";
import { Card, EmptyState, Money, Skeleton, StatusBadge, Tabs } from "../ds/ui";
import { useWallet } from "./Home";

export interface WalletTxn { txn_ref: string; type: string; amount: { minor: number }; status: string; display_status: string; merchant: string | null; created_at: string }

const INCOMING = new Set(["TOPUP", "REVERSAL", "REFUND", "GREEN_POT_OUT"]);

export function ActivityRow({ t }: { t: WalletTxn }) {
  const nav = useNavigate();
  const incoming = INCOMING.has(t.type);
  const meta = paymentMeta(t.status);
  const title = t.type === "TOPUP" ? "Wallet top-up" : t.type === "REVERSAL" ? "Returned to wallet"
    : t.type === "GREEN_POT_IN" ? "Into your green pot" : t.type === "GREEN_POT_OUT" ? "From your green pot" : t.merchant || "Payment";
  const Icon = t.type.startsWith("GREEN_POT") ? PiggyBank : t.type === "REVERSAL" ? RotateCcw : incoming ? ArrowDownLeft : ArrowUpRight;
  const clickable = t.type === "PAYMENT";
  const Tag: any = clickable ? "button" : "div";
  return (
    <Tag onClick={clickable ? () => nav(`/app/txn/${t.txn_ref}`) : undefined}
      className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-hover">
      <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sunken text-fg-2"><Icon className="h-4.5 w-4.5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-fg">{title}</span>
        <span className="block truncate text-caption text-fg-muted">{new Date(t.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · <span className="ref text-[11.5px]">{t.txn_ref}</span></span>
      </span>
      <span className="flex flex-col items-end gap-1">
        <Money minor={incoming ? t.amount.minor : -t.amount.minor} sign className={`text-body font-semibold ${incoming ? "text-success" : "text-fg"}`} />
        {t.type === "PAYMENT" && !["SETTLED", "RECONCILED"].includes(t.status) && <StatusBadge meta={meta} size="sm" />}
      </span>
    </Tag>
  );
}

type Filter = "all" | "paid" | "progress" | "returned";
const MATCH: Record<Filter, (t: WalletTxn) => boolean> = {
  all: () => true,
  paid: (t) => ["SETTLED", "RECONCILED", "COMPLETED"].includes(t.status),
  progress: (t) => ["CREATED", "VALIDATED", "AUTHORISED", "POSTED", "PENDING", "UNDER_REVIEW"].includes(t.status),
  returned: (t) => ["REVERSED", "REJECTED", "FAILED", "EXPIRED"].includes(t.status) || t.type === "REVERSAL",
};

export default function Activity({ user }: { user: string }) {
  const { data: w, isLoading } = useWallet(user);
  const [f, setF] = useState<Filter>("all");
  const groups = useMemo(() => {
    const out: { day: string; items: WalletTxn[] }[] = [];
    for (const t of (w?.transactions || []).filter(MATCH[f])) {
      const d = new Date(t.created_at);
      const today = new Date();
      const label = d.toDateString() === today.toDateString() ? "Today" : d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
      (out.at(-1)?.day === label ? out.at(-1)! : (out.push({ day: label, items: [] }), out.at(-1)!)).items.push(t);
    }
    return out;
  }, [w, f]);
  const count = (k: Filter) => (w?.transactions || []).filter(MATCH[k]).length;

  return (
    <div className="safe-top px-5 pb-8">
      <h1 className="pt-4 text-title-1 text-fg">Activity</h1>
      <p className="text-body-sm text-fg-2">Your last 30 wallet movements, straight from the ledger.</p>
      <div className="mt-4 overflow-x-auto"><Tabs label="Filter activity" value={f} onChange={setF} tabs={[
        { id: "all", label: "All", count: count("all") }, { id: "paid", label: "Paid", count: count("paid") },
        { id: "progress", label: "In progress", count: count("progress") }, { id: "returned", label: "Returned", count: count("returned") }]} /></div>
      <div className="mt-5 space-y-5">
        {isLoading && <Card className="p-4"><Skeleton className="h-4 w-40" /><Skeleton className="mt-3 h-4 w-56" /></Card>}
        {w && groups.length === 0 && <EmptyState title="Nothing here" body="Nothing matches this filter yet." />}
        {groups.map((g) => (
          <motion.section key={g.day} layout aria-label={g.day}>
            <h2 className="mb-2 text-overline uppercase text-fg-muted">{g.day}</h2>
            <Card className="divide-y divide-line overflow-hidden">{g.items.map((t) => <ActivityRow key={t.txn_ref} t={t} />)}</Card>
          </motion.section>
        ))}
      </div>
    </div>
  );
}
