// Theme 4: Services, the super-app hub. Every partner is paid through the same review screen, and an order's
// status is read from its payment, so "Bill paid" or "Cover active" can only appear once the ledger has settled.
import { ArrowLeft, Bot, Flame, FlaskConical, Leaf, Lock, ReceiptText, Shield, ShoppingBag, Smartphone, Tag, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Dialog } from "../ds/overlay";
import { Alert, Badge, Button, Card, EmptyState, IconButton, Input, Money, Skeleton, cx, pkr } from "../ds/ui";
import { ApiError, call } from "../lib/api";
import { useAction, useApi } from "../lib/hooks";
import { useSandboxEnabled } from "./Sandbox";

interface Item { sku: string; name: string; price_minor: number }
interface Service { code: string; name: string; kind: "BILLER" | "TOPUP" | "SHOP" | "INSURER"; tagline: string; icon: string;
  available: boolean; scopes: string[]; consented: boolean; offer?: string; items?: Item[]; amounts?: number[] }
interface Hub { services: Service[]; not_offered: { name: string; reason: string }[]; note: string }
export interface Order { ref: string; partner: string; partner_name: string; kind: string; lines: { name: string; qty: number; price_minor: number }[];
  discount_minor: number; amount_minor: number; status: "AWAITING_PAYMENT" | "PROCESSING" | "COMPLETED" | "NOT_PAID" | "EXPIRED";
  fulfilment: string | null; payment: { txn_ref: string; display_status: string } | null; payment_request_id: string; shared_with_partner: string[]; created_at: string }

const ICON: Record<string, any> = { zap: Zap, flame: Flame, smartphone: Smartphone, "shopping-bag": ShoppingBag, shield: Shield };
const SCOPE: Record<string, string> = { name: "your name", mobile_masked: "your mobile number (masked)" };
const STATUS: Record<Order["status"], { label: string; tone: "success" | "processing" | "neutral" | "warning" | "danger" }> = {
  COMPLETED: { label: "Done", tone: "success" }, PROCESSING: { label: "Processing", tone: "processing" },
  AWAITING_PAYMENT: { label: "Waiting for payment", tone: "neutral" }, NOT_PAID: { label: "Not paid", tone: "danger" }, EXPIRED: { label: "Expired", tone: "neutral" },
};

export default function Services({ user }: { user: string }) {
  const nav = useNavigate();
  const hub = useApi<Hub>(user, "/v1/services");
  const orders = useApi<Order[]>(user, "/v1/services/orders", { refetchInterval: 4000 });
  const sandbox = useSandboxEnabled(user);   // shown only when the server switches the sandbox on
  const tile = (icon: any, title: string, sub: string, onClick: () => void, extra?: React.ReactNode, disabled?: boolean) => {
    const Icon = icon;
    return (
      <button onClick={onClick} disabled={disabled} className="flex h-full w-full flex-col items-start gap-2 rounded-lg border border-line bg-surface p-3.5 text-left shadow-e1 transition-transform hover:bg-hover active:scale-[0.98] disabled:opacity-55">
        <span aria-hidden className="grid h-9 w-9 place-items-center rounded-md bg-brand-soft text-brand-accent"><Icon className="h-4.5 w-4.5" /></span>
        <span className="min-w-0"><span className="block text-body-sm font-semibold text-fg">{title}</span><span className="block text-caption text-fg-2">{sub}</span></span>
        {extra}
      </button>
    );
  };
  return (
    <div className="safe-top px-5 pb-10">
      <h1 className="pt-3 text-title-1 text-fg">Services</h1>
      <p className="text-body-sm text-fg-2">Bills, top-up, shopping and cover. You confirm every payment on the usual review screen.</p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {hub.isLoading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
        {hub.data?.services.map((s) => (
          <div key={s.code}>{tile(ICON[s.icon] || ShoppingBag, s.name.replace(/ \(synthetic.*\)/, ""), s.available ? s.tagline : "Temporarily unavailable",
            () => nav(`/app/services/${s.code}`),
            s.offer && s.available ? <Badge tone="info" className="mt-0.5"><Tag className="mr-1 inline h-3 w-3" aria-hidden />Offer</Badge> : undefined, !s.available)}</div>
        ))}
        {hub.data && <>
          {tile(Leaf, "Green", "Footprint, green pot, offsets", () => nav("/app/green"))}
          {tile(Bot, "Ask Paya", "Questions about your money", () => nav("/app/assistant"))}
          {sandbox && tile(FlaskConical, "Stablecoin sandbox", "Test tokens only, no value", () => nav("/app/sandbox"),
            <Badge tone="warning" className="mt-0.5">Sandbox</Badge>)}
        </>}
      </div>
      {hub.data?.not_offered.map((n) => (
        <p key={n.name} className="mt-3 flex items-start gap-1.5 text-caption text-fg-muted"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /><span><b className="font-semibold text-fg-2">{n.name}: not offered.</b> {n.reason}</span></p>
      ))}

      <section aria-labelledby="ord-h" className="mt-7">
        <h2 id="ord-h" className="flex items-center gap-2 text-title-3 text-fg"><ReceiptText className="h-4 w-4" aria-hidden />My orders</h2>
        <div className="mt-3">
          {orders.data && orders.data.length === 0 && <EmptyState icon={<ReceiptText className="h-5 w-5" />} title="No orders yet" body="Pay a bill or try Bazaar Lane." />}
          {orders.data && orders.data.length > 0 && <Card className="divide-y divide-line overflow-hidden">{orders.data.slice(0, 8).map((o) => <OrderRow key={o.ref} o={o} />)}</Card>}
        </div>
      </section>
      <p className="mt-4 text-caption text-fg-muted">{hub.data?.note}</p>
    </div>
  );
}

function OrderRow({ o }: { o: Order }) {
  const nav = useNavigate();
  const st = STATUS[o.status];
  const go = () => o.status === "AWAITING_PAYMENT" ? nav(`/app/pay/${o.payment_request_id}`) : o.payment ? nav(`/app/txn/${o.payment.txn_ref}`) : undefined;
  return (
    <button onClick={go} className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-hover">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-sm font-medium text-fg">{o.partner_name.replace(/ \(synthetic.*\)/, "")}</span>
        <span className="block truncate text-caption text-fg-muted">{o.fulfilment || o.lines.map((l) => l.qty > 1 ? `${l.qty}× ${l.name}` : l.name).join(", ")} · <span className="ref text-[11px]">{o.ref}</span></span>
      </span>
      <span className="flex flex-col items-end gap-1">
        <Money minor={o.amount_minor} className="text-body-sm font-semibold text-fg" />
        <Badge tone={st.tone}>{st.label}</Badge>
      </span>
    </button>
  );
}

// ------------------------------------------------------------------ one partner
export function ServiceScreen({ user }: { user: string }) {
  const { code } = useParams();
  const nav = useNavigate();
  const hub = useApi<Hub>(user, "/v1/services");
  const s = hub.data?.services.find((x) => x.code === code);
  const [askConsent, setAskConsent] = useState(false);
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);

  const place = useAction(async (body: Record<string, unknown>) =>
    (await call<Order>(user, `/v1/services/${code}/orders`, { method: "POST", body: JSON.stringify(body) })).data,
    { onDone: (o) => nav(`/app/pay/${o.payment_request_id}`) });
  const buy = (body: Record<string, unknown>) => {
    if (s && !s.consented) { setPending(body); setAskConsent(true); return; }
    place.mutate(body);
  };

  if (hub.isLoading) return <div className="p-5"><Skeleton className="h-40 rounded-lg" /></div>;
  if (!s) return <div className="p-5"><EmptyState title="Service not found" action={<Button onClick={() => nav("/app/services")}>Back to Services</Button>} /></div>;
  const Icon = ICON[s.icon] || ShoppingBag;
  return (
    <div className="safe-top px-5 pb-10">
      <div className="flex items-center gap-2 pt-2">
        <IconButton label="Back" onClick={() => nav("/app/services")}><ArrowLeft className="h-5 w-5" /></IconButton>
        <span aria-hidden className="grid h-9 w-9 place-items-center rounded-md bg-brand-soft text-brand-accent"><Icon className="h-4.5 w-4.5" /></span>
        <div className="min-w-0"><h1 className="truncate text-title-3 text-fg">{s.name}</h1><p className="text-caption text-fg-2">{s.tagline}</p></div>
      </div>
      {!s.available && <div className="mt-4"><Alert tone="warning" title="Temporarily unavailable">Paya has paused this partner. Payments you already made are not affected.</Alert></div>}
      {s.available && (
        <div className="mt-4">
          {s.kind === "BILLER" && <Bill user={user} s={s} onPay={buy} busy={place.isPending} />}
          {s.kind === "TOPUP" && <TopUp s={s} onPay={buy} busy={place.isPending} />}
          {(s.kind === "SHOP" || s.kind === "INSURER") && <Catalogue s={s} onPay={buy} busy={place.isPending} />}
        </div>
      )}
      <p className="mt-5 text-caption text-fg-muted">
        {s.scopes.length ? `This partner receives ${s.scopes.map((x) => SCOPE[x]).join(" and ")} with your consent${s.consented ? " (given)" : ""}.` : "This partner receives no personal data from Paya."}
        {" "}Synthetic partner for the demo.
      </p>
      {s.consented && s.scopes.length > 0 && <RevokeConsent user={user} code={s.code} />}
      <ConsentDialog open={askConsent} s={s} user={user} onClose={() => setAskConsent(false)} onGranted={() => { setAskConsent(false); if (pending) place.mutate(pending); }} />
    </div>
  );
}

function Bill({ user, s, onPay, busy }: { user: string; s: Service; onPay: (b: Record<string, unknown>) => void; busy: boolean }) {
  const [no, setNo] = useState("");
  const [bill, setBill] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const lookup = async () => {
    setErr(null); setBill(null);
    try { setBill((await call(user, `/v1/services/${s.code}/bill-lookup`, { method: "POST", body: JSON.stringify({ consumer_no: no }) })).data); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Couldn't find that bill"); }
  };
  return (
    <Card className="p-4">
      <Input label="Consumer number" inputMode="numeric" maxLength={10} value={no} onChange={(e) => { setNo(e.target.value.replace(/\D/g, "")); setBill(null); }}
        hint="10 digits, printed on your bill. Any 10 digits work in the demo." error={err} />
      <Button className="mt-3" block variant="secondary" disabled={no.length !== 10} onClick={lookup}>Find bill</Button>
      {bill && (
        <div className="mt-4 rounded-md bg-sunken p-3.5">
          <dl className="space-y-1 text-body-sm">
            <div className="flex justify-between"><dt className="text-fg-2">Account</dt><dd className="text-fg">{bill.holder}</dd></div>
            <div className="flex justify-between"><dt className="text-fg-2">Month</dt><dd className="text-fg">{bill.period}</dd></div>
            <div className="flex justify-between"><dt className="text-fg-2">Due</dt><dd className="text-fg">{bill.due}</dd></div>
            <div className="flex justify-between"><dt className="text-fg-2">Amount</dt><dd><Money minor={bill.amount_minor} className="font-semibold text-fg" /></dd></div>
          </dl>
          {bill.status === "UNPAID" ? <Button className="mt-3" block loading={busy} onClick={() => onPay({ consumer_no: no })}>Pay {pkr(bill.amount_minor)}</Button>
            : <p className="mt-3 text-body-sm font-semibold text-fg">{bill.status === "PAID" ? "This bill is already paid" : "This bill is being paid"} <span className="ref text-[11px] font-normal text-fg-2">{bill.paid_by_order}</span></p>}
        </div>
      )}
    </Card>
  );
}

function TopUp({ s, onPay, busy }: { s: Service; onPay: (b: Record<string, unknown>) => void; busy: boolean }) {
  const [amt, setAmt] = useState<number | null>(null);
  return (
    <Card className="p-4">
      <p className="text-label text-fg">Top up your own number</p>
      <div className="mt-3 grid grid-cols-4 gap-2" role="radiogroup" aria-label="Top-up amount">
        {s.amounts!.map((a) => (
          <button key={a} role="radio" aria-checked={amt === a} onClick={() => setAmt(a)}
            className={cx("rounded-md border py-2.5 text-body-sm font-semibold", amt === a ? "border-brand bg-brand-soft text-fg" : "border-line text-fg-2 hover:bg-hover")}>{pkr(a)}</button>
        ))}
      </div>
      <Button className="mt-4" block disabled={!amt} loading={busy} onClick={() => onPay({ amount_minor: amt })}>{amt ? `Top up ${pkr(amt)}` : "Choose an amount"}</Button>
    </Card>
  );
}

function Catalogue({ s, onPay, busy }: { s: Service; onPay: (b: Record<string, unknown>) => void; busy: boolean }) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [offer, setOffer] = useState(!!s.offer);
  const insurer = s.kind === "INSURER";
  const lines = useMemo(() => Object.entries(qty).filter(([, q]) => q > 0), [qty]);
  const total = lines.reduce((a, [sku, q]) => a + q * (s.items!.find((i) => i.sku === sku)!.price_minor), 0);
  const set = (sku: string, q: number) => setQty((x) => ({ ...x, [sku]: Math.max(0, Math.min(insurer ? 1 : 10, q)) }));
  return (
    <>
      {s.offer && <label className="mb-3 flex items-start gap-2 rounded-md border border-info-line bg-info-soft p-3 text-body-sm text-fg">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" checked={offer} onChange={(e) => setOffer(e.target.checked)} />
        <span><b>Use offer.</b> {s.offer}. The final price is calculated by Paya's server.</span></label>}
      <Card className="divide-y divide-line overflow-hidden">
        {s.items!.map((i) => (
          <div key={i.sku} className="flex items-center gap-3 px-3.5 py-3">
            <span className="min-w-0 flex-1"><span className="block text-body-sm font-medium text-fg">{i.name}</span><Money minor={i.price_minor} className="text-caption text-fg-2" /></span>
            {insurer ? (
              <Button size="sm" variant={qty[i.sku] ? "primary" : "secondary"} aria-pressed={!!qty[i.sku]} onClick={() => set(i.sku, qty[i.sku] ? 0 : 1)}>{qty[i.sku] ? "Selected" : "Select"}</Button>
            ) : (
              <div className="flex items-center gap-1">
                <IconButton label={`Remove one ${i.name}`} onClick={() => set(i.sku, (qty[i.sku] || 0) - 1)} disabled={!qty[i.sku]}>−</IconButton>
                <span className="num w-6 text-center text-body-sm font-semibold text-fg" aria-live="polite">{qty[i.sku] || 0}</span>
                <IconButton label={`Add one ${i.name}`} onClick={() => set(i.sku, (qty[i.sku] || 0) + 1)}>+</IconButton>
              </div>
            )}
          </div>
        ))}
      </Card>
      <Button className="mt-4" block disabled={!lines.length} loading={busy}
        onClick={() => onPay({ items: lines.map(([sku, q]) => ({ sku, qty: q })), use_offer: offer && !!s.offer })}>
        {lines.length ? `Continue · ${pkr(total)}${offer && s.offer ? " before offer" : ""}` : insurer ? "Choose cover" : "Add items"}
      </Button>
      {insurer && <p className="mt-2 text-caption text-fg-2">Cover is provided by the partner, not by Paya. It starts once Raast confirms your payment and lasts one month.</p>}
    </>
  );
}

function ConsentDialog({ open, s, user, onClose, onGranted }: { open: boolean; s: Service; user: string; onClose: () => void; onGranted: () => void }) {
  const grant = useAction(async () => (await call(user, `/v1/services/${s.code}/consent`, { method: "POST", body: JSON.stringify({ grant: true }) })).data,
    { success: () => "Consent saved", onDone: onGranted });
  return (
    <Dialog open={open} onClose={onClose} title={`Share details with ${s.name.replace(/ \(synthetic.*\)/, "")}?`}
      description="The partner needs these to provide the service. Nothing else is shared, and you can withdraw consent at any time."
      footer={<><Button variant="ghost" onClick={onClose}>Not now</Button><Button loading={grant.isPending} onClick={() => grant.mutate()}>Allow and continue</Button></>}>
      <ul className="space-y-1.5 text-body-sm text-fg">{s.scopes.map((x) => <li key={x} className="flex items-center gap-2"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand" />{SCOPE[x]}</li>)}</ul>
      <p className="mt-3 text-caption text-fg-2">Not shared: your balance, your payments, your identity documents.</p>
    </Dialog>
  );
}

function RevokeConsent({ user, code }: { user: string; code: string }) {
  const revoke = useAction(async () => (await call(user, `/v1/services/${code}/consent`, { method: "POST", body: JSON.stringify({ grant: false }) })).data,
    { success: () => "Consent withdrawn" });
  return <button onClick={() => revoke.mutate()} className="mt-1 text-caption font-semibold text-brand-accent underline">Withdraw consent</button>;
}
