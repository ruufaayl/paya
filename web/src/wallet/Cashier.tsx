// Merchant till: enter an amount, show a dynamic Raast QR, and show PAID only when the ledger has settled it.
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Delete, LogOut, Volume2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";
import { spring } from "../ds/motion";
import { paymentMeta } from "../ds/status";
import { Alert, Button, Card, IconButton, Logo, Money, StatusBadge, pkr } from "../ds/ui";
import { useToast } from "../ds/toast";
import { call, session } from "../lib/api";
import { useApi } from "../lib/hooks";
import { speak, useStream } from "../lib/stream";

interface PR { id: string; order_ref: string; amount: { minor: number }; status: string; qr_payload: string; merchant: { name: string }; latest_payment: { txn_ref: string; status: string; display_status: string } | null }
interface Sale { txn_ref: string; order_ref: string; amount: { minor: number }; status: string; display_status: string; paid: boolean; created_at: string }

export default function Cashier({ user, onSignOut }: { user: string; onSignOut: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [digits, setDigits] = useState("");
  const [prId, setPrId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const announced = useRef<string | null>(null);
  const sales = useApi<Sale[]>(user, "/v1/merchant/transactions");
  const pr = useApi<PR>(user, prId ? `/v1/payment-requests/${prId}` : null, { refetchInterval: 2000 });
  useStream(user, (m) => { if (m.kind === "event") qc.invalidateQueries(); });

  const status = pr.data?.latest_payment?.status;
  const paid = status === "SETTLED" || status === "RECONCILED";
  useEffect(() => {
    if (paid && pr.data && announced.current !== pr.data.id) {
      announced.current = pr.data.id;
      speak(`Rupees ${Math.round(pr.data.amount.minor / 100).toLocaleString("en-US")} received. Payment pakka.`);
    }
  }, [paid, pr.data]);

  const amountMinor = Math.round(Number(digits || "0") * 100);
  const key = (k: string) => setDigits((d) => (k === "del" ? d.slice(0, -1) : (d + k).replace(/^0+(?=\d)/, "").slice(0, 7)));
  const create = async () => {
    setBusy(true);
    try {
      const r = await call<PR>(user, "/v1/payment-requests", { method: "POST", body: JSON.stringify({ amount_minor: amountMinor, order_ref: `ORD-${Date.now().toString(36).toUpperCase()}` }) });
      setPrId(r.data.id); announced.current = null;
    } catch (e) { toast.error(e, "Couldn't create the QR"); } finally { setBusy(false); }
  };
  const reset = () => { setPrId(null); setDigits(""); qc.invalidateQueries(); };
  const p = pr.data;

  return (
    <div className="mx-auto min-h-full max-w-[480px] bg-canvas">
      <div className="safe-top flex items-center justify-between px-5 pt-2">
        <Logo size={24} suffix="Till" />
        <div className="flex items-center gap-2">
          <span className="text-caption text-fg-2">{session(user)?.display_name?.split("(")[0]}</span>
          <IconButton label="Sign out" onClick={onSignOut}><LogOut className="h-4 w-4" /></IconButton>
        </div>
      </div>
      <div className="px-5 pb-8">
        <AnimatePresence mode="wait">
          {!p ? (
            <motion.section key="pad" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} aria-label="New sale">
              <p className="mt-6 text-center text-body-sm text-fg-2">New sale</p>
              <p className="num mt-1 text-center font-display text-amount-xl text-fg" aria-live="polite">Rs {Number(digits || "0").toLocaleString("en-PK")}</p>
              <div className="mt-6 grid grid-cols-3 gap-2.5">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "del"].map((k) => (
                  <motion.button key={k} whileTap={{ scale: 0.94 }} onClick={() => key(k)} aria-label={k === "del" ? "Delete digit" : k}
                    className="grid h-16 place-items-center rounded-lg border border-line bg-surface font-display text-title-1 text-fg shadow-e1">
                    {k === "del" ? <Delete className="h-6 w-6" /> : k}
                  </motion.button>
                ))}
              </div>
              <Button size="lg" block className="mt-5" disabled={amountMinor <= 0} loading={busy} onClick={create}>Show Raast QR</Button>
            </motion.section>
          ) : paid ? (
            <motion.section key="paid" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-8 flex flex-col items-center text-center" aria-live="assertive">
              <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={spring.settle}
                className="grid h-40 w-40 place-items-center rounded-full border-4 border-success-line bg-success-soft text-success">
                <Check className="h-20 w-20" strokeWidth={3} aria-hidden />
              </motion.div>
              <h1 className="mt-6 font-display text-[3.5rem] font-extrabold leading-none tracking-tight text-success">PAID</h1>
              <Money minor={p.amount.minor} className="mt-2 font-display text-amount text-fg" />
              <p className="mt-2 text-body-sm text-fg-2">Confirmed by Raast and posted to the ledger.</p>
              <p className="ref text-[12px] text-fg-muted">{p.latest_payment?.txn_ref} · {p.order_ref}</p>
              <Button variant="ghost" size="sm" className="mt-3" icon={<Volume2 className="h-4 w-4" />} onClick={() => speak(`Rupees ${Math.round(p.amount.minor / 100)} received`)}>Replay announcement</Button>
              <Button size="lg" block className="mt-6" onClick={reset}>New sale</Button>
            </motion.section>
          ) : (
            <motion.section key="qr" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 flex flex-col items-center text-center" aria-label="Waiting for payment">
              <p className="text-body-sm text-fg-2">{p.merchant.name} · <span className="ref">{p.order_ref}</span></p>
              <Money minor={p.amount.minor} className="font-display text-amount-xl text-fg" />
              <div className="relative mt-5 rounded-xl border border-line bg-white p-5 shadow-e2">
                <QRCodeSVG value={p.qr_payload} size={228} bgColor="#ffffff" fgColor="#0C1B24" level="M" title={`Raast QR for ${pkr(p.amount.minor)}`} />
                {status && <div className="absolute inset-0 grid place-items-center rounded-xl bg-white/90"><StatusBadge meta={paymentMeta(status)} label={p.latest_payment?.display_status} /></div>}
              </div>
              <p className="mt-5 max-w-xs text-body-sm text-fg-2" aria-live="polite">{status ? "Customer is paying. Don't hand over goods until this screen says PAID." : "Ask the customer to scan with a Raast-enabled app."}</p>
              {(status === "REVERSED" || status === "REJECTED") && <div className="mt-3 w-full text-left"><Alert tone="danger" title="Payment didn't go through">Ask for another payment method.</Alert></div>}
              <Button variant="ghost" className="mt-4" onClick={reset}>Cancel sale</Button>
            </motion.section>
          )}
        </AnimatePresence>

        <section aria-labelledby="today-h" className="mt-10">
          <h2 id="today-h" className="text-title-3 text-fg">Today at this till</h2>
          <Card className="mt-3 divide-y divide-line overflow-hidden">
            {(sales.data || []).length === 0 && <p className="p-4 text-body-sm text-fg-2">No sales yet.</p>}
            {(sales.data || []).slice(0, 8).map((s) => (
              <div key={s.txn_ref} className="flex items-center gap-3 px-3.5 py-3">
                <span className="flex-1"><Money minor={s.amount.minor} className="block text-body font-semibold text-fg" /><span className="ref block text-[11.5px] text-fg-muted">{s.order_ref}</span></span>
                <StatusBadge meta={paymentMeta(s.status)} size="sm" label={s.paid ? "Paid" : undefined} />
              </div>
            ))}
          </Card>
        </section>
      </div>
    </div>
  );
}
