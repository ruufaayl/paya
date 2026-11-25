// Theme 2: Green. An honest estimate of the carbon linked to your spending, a green pot that ring-fences your
// own money (ledger account 2110), and offsets paid through the normal Raast review. Nothing here is invented
// client-side: every number comes from the server, and the estimate is labelled as one.
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Info, Leaf, PiggyBank, Sprout, Trees } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog } from "../ds/overlay";
import { Alert, Badge, Button, Card, IconButton, Input, Money, Skeleton, pkr } from "../ds/ui";
import { call, newIdempotencyKey } from "../lib/api";
import { useAction, useApi } from "../lib/hooks";

interface Footprint {
  days: number; factor_set: string; total_kg: number; range_kg: [number, number]; offset_kg: number; method: string;
  categories: { category: string; label: string; payments: number; spent_minor: number; kg: number; factor_kg_per_1000: number }[];
}
interface Pot { balance: number; wallet_available: number; limit: number; roundup_suggested: number; eligible: boolean;
  moves: { txn_ref: string; direction: "IN" | "OUT"; amount_minor: number; at: string }[] }
interface Offsets { price_per_tonne_minor: number; project: string; disclaimer: string;
  items: { txn_ref: string; amount_minor: number; status: string; display_status: string; kg_offset: number; certificate_ref: string | null; at: string }[] }

type MoveKind = "IN" | "OUT" | "ROUND_UP";
const kg = (n: number) => n >= 1000 ? `${(n / 1000).toLocaleString("en-PK", { maximumFractionDigits: 2 })} t` : `${n.toLocaleString("en-PK", { maximumFractionDigits: 1 })} kg`;

export default function Green({ user }: { user: string }) {
  const nav = useNavigate();
  const f = useApi<Footprint>(user, "/v1/green/footprint");
  const pot = useApi<Pot>(user, "/v1/green/pot");
  const off = useApi<Offsets>(user, "/v1/green/offsets");
  const [moving, setMoving] = useState<MoveKind | null>(null);
  const max = Math.max(1, ...(f.data?.categories.map((c) => c.kg) || [0]));

  const offset = useAction(async (amount_minor: number) =>
    (await call<{ id: string }>(user, "/v1/green/offsets", { method: "POST", body: JSON.stringify({ amount_minor }) })).data,
    { onDone: (r) => nav(`/app/pay/${r.id}`), invalidate: false });

  return (
    <div className="safe-top px-5 pb-10">
      <div className="flex items-center gap-2 pt-2">
        <IconButton label="Back" onClick={() => nav("/app")}><ArrowLeft className="h-5 w-5" /></IconButton>
        <h1 className="text-title-2 text-fg">Green</h1>
      </div>

      {/* Footprint estimate */}
      <section aria-labelledby="fp-h" className="mt-4 rounded-xl bg-night p-5 text-night-fg shadow-e2">
        <div className="flex items-center justify-between">
          <h2 id="fp-h" className="flex items-center gap-1.5 text-label text-night-fg/75"><Leaf className="h-4 w-4" aria-hidden />Your spending's footprint, last 30 days</h2>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11.5px] font-semibold">Estimate</span>
        </div>
        {f.isLoading ? <div className="mt-2 h-10 w-40 animate-pulse rounded-md bg-white/10" /> : f.data && (
          <>
            <p className="num mt-1 font-display text-amount-xl">about {kg(f.data.total_kg)}</p>
            <p className="text-body-sm text-night-fg/75">CO₂e · likely between {kg(f.data.range_kg[0])} and {kg(f.data.range_kg[1])}</p>
            {f.data.offset_kg > 0 && <p className="mt-2 flex items-center gap-1.5 text-body-sm font-semibold"><Trees className="h-4 w-4" aria-hidden />You offset about {kg(f.data.offset_kg)} this month</p>}
          </>
        )}
      </section>

      {f.data && (
        <Card className="mt-3 p-4">
          <h3 className="text-label text-fg">Where it comes from</h3>
          {f.data.categories.filter((c) => c.kg > 0).length === 0 && <p className="mt-2 text-body-sm text-fg-2">No settled payments in the last 30 days yet.</p>}
          <ul className="mt-2 space-y-2.5">
            {f.data.categories.filter((c) => c.kg > 0).map((c) => (
              <li key={c.category}>
                <div className="flex items-baseline justify-between text-body-sm"><span className="text-fg">{c.label}</span><span className="num font-semibold text-fg">{kg(c.kg)}</span></div>
                <div className="mt-1 h-2 rounded-full bg-sunken" aria-hidden><div className="h-2 rounded-full bg-brand" style={{ width: `${(c.kg / max) * 100}%` }} /></div>
                <p className="mt-0.5 text-caption text-fg-muted">{pkr(c.spent_minor)} in {c.payments} payment{c.payments === 1 ? "" : "s"} × {c.factor_kg_per_1000} kg per Rs 1,000</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex items-start gap-1.5 text-caption text-fg-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{f.data.method} Factors: {f.data.factor_set} (illustrative).</p>
        </Card>
      )}

      {/* Green pot */}
      <section aria-labelledby="pot-h" className="mt-6">
        <h2 id="pot-h" className="flex items-center gap-2 text-title-3 text-fg"><PiggyBank className="h-4 w-4" aria-hidden />Green pot</h2>
        <p className="text-caption text-fg-2">Your own money, set aside for greener choices. It stays in your Rupay wallet and you can move it back at any time.</p>
        <Card className="mt-3 p-4">
          {pot.isLoading ? <Skeleton className="h-8 w-32" /> : pot.data && (
            <>
              <div className="flex items-end justify-between">
                <div><p className="text-caption text-fg-2">In your pot</p><Money minor={pot.data.balance} className="font-display text-title-1 text-fg" /></div>
                <Badge tone="neutral">Ledger 2110</Badge>
              </div>
              {!pot.data.eligible ? <Alert tone="info" title="Verify your wallet first">A green pot needs a verified wallet.</Alert> : (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button variant="primary" icon={<ArrowDownToLine className="h-4 w-4" />} onClick={() => setMoving("IN")}>Add money</Button>
                  <Button variant="secondary" icon={<ArrowUpFromLine className="h-4 w-4" />} disabled={!pot.data.balance} onClick={() => setMoving("OUT")}>To wallet</Button>
                  {pot.data.roundup_suggested > 0 && (
                    <Button variant="subtle" className="col-span-2" icon={<Sprout className="h-4 w-4" />} onClick={() => setMoving("ROUND_UP")}>
                      Add my round-ups ({pkr(pot.data.roundup_suggested)})
                    </Button>
                  )}
                </div>
              )}
              {pot.data.moves.length > 0 && (
                <ul className="mt-3 divide-y divide-line border-t border-line text-body-sm">
                  {pot.data.moves.slice(0, 4).map((m) => (
                    <li key={m.txn_ref} className="flex items-center justify-between py-2">
                      <span className="text-fg-2">{m.direction === "IN" ? "Into pot" : "Back to wallet"} · <span className="ref text-[11.5px]">{m.txn_ref}</span></span>
                      <Money minor={m.direction === "IN" ? m.amount_minor : -m.amount_minor} sign className="font-semibold text-fg" />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Card>
      </section>

      {/* Offsets */}
      <section aria-labelledby="off-h" className="mt-6">
        <h2 id="off-h" className="flex items-center gap-2 text-title-3 text-fg"><Trees className="h-4 w-4" aria-hidden />Offset</h2>
        {off.data && <p className="text-caption text-fg-2">Support {off.data.project} at {pkr(off.data.price_per_tonne_minor)} per tonne. You'll review and confirm it like any payment.</p>}
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[300_00, 1_500_00, 3_000_00].map((a) => (
            <button key={a} disabled={offset.isPending} onClick={() => offset.mutate(a)}
              className="rounded-lg border border-line bg-surface p-3 text-left shadow-e1 transition-transform hover:bg-hover active:scale-[0.98] disabled:opacity-50">
              <span className="num block text-body font-semibold text-fg">{pkr(a)}</span>
              <span className="block text-caption text-fg-2">≈ {kg(off.data ? (a / off.data.price_per_tonne_minor) * 1000 : 0)}</span>
            </button>
          ))}
        </div>
        {off.data && off.data.items.length > 0 && (
          <Card className="mt-3 divide-y divide-line overflow-hidden">
            {off.data.items.slice(0, 5).map((o) => (
              <button key={o.txn_ref} onClick={() => nav(`/app/txn/${o.txn_ref}`)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-hover">
                <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-brand-soft text-brand-accent"><Trees className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body-sm font-medium text-fg">{o.certificate_ref ? `Certificate ${o.certificate_ref}` : "Waiting for Raast"}</span>
                  <span className="block text-caption text-fg-muted">{o.certificate_ref ? `about ${kg(o.kg_offset)} · ${o.display_status}` : o.display_status}</span>
                </span>
                <Money minor={o.amount_minor} className="text-body-sm font-semibold text-fg" />
              </button>
            ))}
          </Card>
        )}
        {off.data && <p className="mt-2 text-caption text-fg-muted">{off.data.disclaimer}</p>}
      </section>

      {pot.data && moving && <MoveDialog user={user} kind={moving} pot={pot.data} onClose={() => setMoving(null)} />}
    </div>
  );
}

function MoveDialog({ user, kind, pot, onClose }: { user: string; kind: MoveKind; pot: Pot; onClose: () => void }) {
  const [key] = useState(newIdempotencyKey);   // one key per intent: a double tap or retry moves money once
  const sent = useRef(false);                  // and the screen sends it once, so a double tap shows no error
  const [rupees, setRupees] = useState(kind === "ROUND_UP" ? String(pot.roundup_suggested / 100) : "");
  const minor = Math.round(Number(rupees) * 100);
  const cap = kind === "OUT" ? pot.balance : kind === "ROUND_UP" ? pot.roundup_suggested : Math.min(pot.wallet_available, pot.limit - pot.balance);
  const error = !rupees ? null : !Number.isInteger(Number(rupees)) || minor <= 0 ? "Whole rupees, above zero" : minor > cap ? `Up to ${pkr(cap)}` : null;
  const act = useAction(async () => (await call(user, "/v1/green/pot/moves", { method: "POST", idempotencyKey: key,
    body: JSON.stringify({ direction: kind === "OUT" ? "OUT" : "IN", amount_minor: minor, source: kind === "ROUND_UP" ? "ROUND_UP" : "MANUAL" }) })).data,
    { success: () => kind === "OUT" ? `${pkr(minor)} moved back to your wallet` : `${pkr(minor)} added to your green pot`, onDone: onClose });
  const title = kind === "OUT" ? "Move to your wallet" : kind === "ROUND_UP" ? "Add your round-ups" : "Add to your green pot";
  return (
    <Dialog open onClose={onClose} title={title}
      description={kind === "ROUND_UP" ? "Your settled payments this month, rounded up to the next Rs 100." : `Available: ${pkr(cap)}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={act.isPending} disabled={!minor || !!error} onClick={() => { if (sent.current) return; sent.current = true; act.mutate(undefined, { onError: () => { sent.current = false; } }); }}>Confirm {minor > 0 ? pkr(minor) : ""}</Button></>}>
      <Input label="Amount (Rs)" inputMode="numeric" autoFocus value={rupees} readOnly={kind === "ROUND_UP"}
        onChange={(e) => setRupees(e.target.value.replace(/[^\d]/g, ""))} error={error}
        hint="Booked in the ledger as one balanced journal between your wallet and your pot." />
    </Dialog>
  );
}
