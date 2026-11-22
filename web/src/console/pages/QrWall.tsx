// QR wall: one live Raast QR per merchant till, side by side. Scan any of them with the wallet on a phone; the card
// flips to PAID only when the ledger has settled the payment, then the till issues its next QR automatically.
import { AnimatePresence, motion } from "framer-motion";
import { Check, RefreshCw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";
import { paymentMeta } from "../../ds/status";
import { Button, Card, StatusBadge, pkr } from "../../ds/ui";
import { call } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { Page } from "../core";

const TILLS = [
  { user: "ayesha.cashier", cashier: "Ayesha", shop: "Chai Junction" },
  { user: "kamran.cashier", cashier: "Kamran", shop: "Shifa Pharmacy" },
  { user: "noor.cashier", cashier: "Noor", shop: "Green Leaf Grocers" },
  { user: "danish.cashier", cashier: "Danish", shop: "Lahore Tikka House" },
  { user: "sadia.cashier", cashier: "Sadia", shop: "Clifton Fuel Stop" },
  { user: "imran.cashier", cashier: "Imran", shop: "Saddar Book Corner" },
];
const AMOUNTS = [150, 250, 350, 480, 650, 850, 1200, 1500, 2200, 3500];
const pickAmount = () => AMOUNTS[Math.floor(Math.random() * AMOUNTS.length)] * 100;

interface PR { id: string; order_ref: string; amount: { minor: number }; status: string; qr_payload: string; merchant: { name: string }; latest_payment: { txn_ref: string; status: string } | null }

function Till({ t }: { t: typeof TILLS[number] }) {
  const [prId, setPrId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const making = useRef(false);
  const pr = useApi<PR>(t.user, prId ? `/v1/payment-requests/${prId}` : null, { refetchInterval: 1500 });
  const make = useCallback(async () => {
    if (making.current) return;
    making.current = true; setErr(null);
    try {
      const r = await call<PR>(t.user, "/v1/payment-requests", { method: "POST", body: JSON.stringify({ amount_minor: pickAmount(), order_ref: `WALL-${t.cashier.toUpperCase()}-${Date.now().toString(36).toUpperCase()}` }) });
      setPrId(r.data.id);
    } catch (e: any) { setErr(e?.message || "Couldn't create a QR"); } finally { making.current = false; }
  }, [t.user]);
  useEffect(() => { make(); }, [make]);
  const st = pr.data?.latest_payment?.status;
  const paid = st === "SETTLED" || st === "RECONCILED";
  const failed = st === "REVERSED" || st === "REJECTED";
  useEffect(() => {
    if (!paid && !failed) return;
    if (paid) setCount((c) => c + 1);
    const id = window.setTimeout(make, paid ? 5000 : 6000);
    return () => window.clearTimeout(id);
  }, [paid, failed, make]);
  const p = pr.data;
  return (
    <Card className="relative flex flex-col items-center overflow-hidden p-4 text-center">
      <div className="flex w-full items-start justify-between gap-2 text-left">
        <div className="min-w-0"><p className="truncate text-body-sm font-semibold text-fg">{t.shop}</p><p className="text-caption text-fg-2">Till · {t.cashier}</p></div>
        <span className="num rounded-full bg-sunken px-2 py-0.5 text-caption text-fg-2" title="Settled on this wall">{count} paid</span>
      </div>
      <div className="relative mt-3 grid h-[196px] w-[196px] place-items-center rounded-md bg-white p-2">
        {p ? <QRCodeSVG value={p.qr_payload} size={180} bgColor="#ffffff" fgColor="#0C1B24" level="M" title={`Raast QR for ${pkr(p.amount.minor)} at ${t.shop}`} />
          : <span className="text-caption text-fg-muted">{err ? "No QR" : "Creating…"}</span>}
        <AnimatePresence>
          {paid && (
            <motion.div initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 grid place-items-center rounded-md bg-success text-white">
              <div><Check className="mx-auto h-12 w-12" aria-hidden /><p className="mt-1 font-display text-title-3 font-bold">PAID</p><p className="text-caption opacity-90">Settled on the ledger</p></div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <p className="mt-3 font-display text-title-2 font-bold text-fg num">{p ? pkr(p.amount.minor) : "—"}</p>
      <div className="mt-1 flex h-6 items-center gap-2">
        {st ? <StatusBadge meta={paymentMeta(st)} size="sm" /> : <span className="text-caption text-fg-2">{p ? "Waiting for a scan" : ""}</span>}
      </div>
      {p && <p className="ref mt-1 text-[11px] text-fg-muted">{p.latest_payment?.txn_ref || p.order_ref}</p>}
      {err && <p role="alert" className="mt-2 text-caption text-danger">{err}</p>}
      <Button size="sm" variant="ghost" className="mt-2" onClick={make}><RefreshCw className="h-3.5 w-3.5" aria-hidden /> New QR</Button>
    </Card>
  );
}

export default function QrWall() {
  return (
    <Page wide title="QR wall" description="Six merchant tills, each showing a live dynamic Raast QR. Scan any of them with the wallet (Scan tab) on a phone. A card turns PAID only once the ledger has settled the payment, then the till issues its next QR. Synthetic merchants, simulated rail, no real money.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {TILLS.map((t) => <Till key={t.user} t={t} />)}
      </div>
    </Page>
  );
}
