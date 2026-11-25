// Theme 5: the stablecoin sandbox. Only reachable when the server runs with PAYA_STABLECOIN_SANDBOX=true.
// Worthless test tokens on a simulated chain; nothing here is money, and nothing converts to rupees.
import { AlertTriangle, ArrowLeft, Copy, Droplets, FlaskConical, Send, Store } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog } from "../ds/overlay";
import { Alert, Badge, Button, Card, EmptyState, IconButton, Input, Skeleton } from "../ds/ui";
import { call, newIdempotencyKey } from "../lib/api";
import { useAction, useApi } from "../lib/hooks";

interface Transfer { ref: string; kind: string; direction: "IN" | "OUT"; to: string; beneficiary: string | null; amount_units: number;
  status: "PENDING" | "CONFIRMED" | "BLOCKED" | "FAILED"; confirmations: number; reason: string | null; at: string }
interface SandboxWallet { enabled: boolean; disclaimer: string; token: string; chain: string; confirmations_required: number; eligible: boolean;
  enrolled: boolean; address?: string; confirmed_units?: number; spendable_units?: number; pending_in_units?: number; pending_out_units?: number;
  faucet_available?: boolean; transfers?: Transfer[]; merchants: { id: string; name: string; address: string }[];
  limits: { per_transfer_units: number; daily_units: number; travel_rule_units: number } }

export const tok = (u: number) => `${(u / 100).toLocaleString("en-PK", { maximumFractionDigits: 2 })} tPKR-TEST`;
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

export function useSandboxEnabled(user: string) {
  return useApi<{ enabled: boolean }>(user, "/v1/sandbox/status", { staleTime: 60_000 }).data?.enabled === true;
}

export default function Sandbox({ user }: { user: string }) {
  const nav = useNavigate();
  const q = useApi<SandboxWallet>(user, "/v1/sandbox/wallet", { refetchInterval: 2000, retry: false });
  const [ack, setAck] = useState(false);
  const [sending, setSending] = useState(false);
  const enrol = useAction(async () => (await call(user, "/v1/sandbox/enrol", { method: "POST", body: JSON.stringify({ acknowledge_no_value: true }) })).data,
    { success: () => "You joined the sandbox" });
  const faucet = useAction(async () => (await call(user, "/v1/sandbox/faucet", { method: "POST" })).data,
    { success: () => "Test tokens requested from the faucet" });
  const w = q.data;

  return (
    <div className="safe-top px-5 pb-10">
      <div className="flex items-center gap-2 pt-2">
        <IconButton label="Back" onClick={() => nav("/app/services")}><ArrowLeft className="h-5 w-5" /></IconButton>
        <h1 className="text-title-2 text-fg">Stablecoin sandbox</h1>
      </div>
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning-line bg-warning-soft p-3 text-body-sm text-fg" role="note">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <span><b>Test tokens only.</b> {w?.disclaimer || "Sandbox only. Test tokens have no value and are not a payment method."}</span>
      </div>

      {q.isLoading && <Skeleton className="mt-4 h-40 rounded-lg" />}
      {q.isError && <div className="mt-4"><EmptyState icon={<FlaskConical className="h-5 w-5" />} title="The sandbox is switched off" body="This server doesn't run the stablecoin sandbox." /></div>}

      {w && !w.enrolled && (
        <Card className="mt-4 p-4">
          <h2 className="text-title-3 text-fg">Try a tokenised payment</h2>
          <p className="mt-1 text-body-sm text-fg-2">See how Rupay would handle a regulated digital-rupee or stablecoin rail: a wallet address, screening, limits, and payments that count only once the chain makes them final.</p>
          {!w.eligible ? <div className="mt-3"><Alert tone="info" title="Fully verified wallets only">The sandbox is open to tier-2 verified wallets.</Alert></div> : (
            <>
              <label className="mt-4 flex items-start gap-2 text-body-sm text-fg">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>I understand these test tokens have no value, can't be exchanged for rupees and are not a payment method.</span>
              </label>
              <Button className="mt-3" block disabled={!ack} loading={enrol.isPending} onClick={() => enrol.mutate()}>Join the sandbox</Button>
            </>
          )}
        </Card>
      )}

      {w && w.enrolled && (
        <>
          <section aria-labelledby="tb-h" className="mt-4 rounded-xl bg-night p-5 text-night-fg shadow-e2">
            <div className="flex items-center justify-between"><h2 id="tb-h" className="text-label text-night-fg/75">Confirmed test balance</h2><span className="rounded-full bg-white/10 px-2 py-0.5 text-[11.5px] font-semibold">{w.chain}</span></div>
            <p className="num mt-1 font-display text-title-1">{tok(w.confirmed_units!)}</p>
            <p className="text-caption text-night-fg/70">Counts after {w.confirmations_required} confirmations. {w.pending_in_units ? `${tok(w.pending_in_units)} on the way in. ` : ""}{w.pending_out_units ? `${tok(w.pending_out_units)} on the way out.` : ""}</p>
            <button onClick={() => navigator.clipboard?.writeText(w.address!)} className="mt-3 flex items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1.5 text-caption" aria-label={`Copy address ${w.address}`}>
              <span className="ref">{short(w.address!)}</span><Copy className="h-3.5 w-3.5" aria-hidden />
            </button>
          </section>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="secondary" icon={<Droplets className="h-4 w-4" />} disabled={!w.faucet_available} loading={faucet.isPending} onClick={() => faucet.mutate()}>{w.faucet_available ? "Get test tokens" : "Faucet used today"}</Button>
            <Button icon={<Send className="h-4 w-4" />} disabled={!w.spendable_units} onClick={() => setSending(true)}>Pay with tokens</Button>
          </div>
          <section aria-labelledby="tt-h" className="mt-6">
            <h2 id="tt-h" className="text-title-3 text-fg">Sandbox transfers</h2>
            {w.transfers!.length === 0 ? <p className="mt-2 text-body-sm text-fg-2">Get test tokens from the faucet to start.</p> : (
              <Card className="mt-3 divide-y divide-line overflow-hidden">
                {w.transfers!.map((t) => <TransferRow key={t.ref} t={t} need={w.confirmations_required} />)}
              </Card>
            )}
          </section>
          {sending && <SendDialog user={user} w={w} onClose={() => setSending(false)} />}
        </>
      )}
    </div>
  );
}

function TransferRow({ t, need }: { t: Transfer; need: number }) {
  const title = t.kind === "FAUCET" ? "From the test faucet" : t.beneficiary || short(t.to);
  const badge = t.status === "CONFIRMED" ? <Badge tone="success">Confirmed</Badge>
    : t.status === "PENDING" ? <Badge tone="processing">{t.confirmations}/{need} confirmations</Badge>
    : <Badge tone="danger">{t.status === "BLOCKED" ? "Blocked" : "Not sent"}</Badge>;
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-sunken text-fg-2">{t.kind === "FAUCET" ? <Droplets className="h-4 w-4" /> : t.kind === "MERCHANT" ? <Store className="h-4 w-4" /> : <Send className="h-4 w-4" />}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-sm font-medium text-fg">{title}</span>
        <span className="block truncate text-caption text-fg-muted">{t.reason || <span className="ref text-[11px]">{t.ref}</span>}</span>
      </span>
      <span className="flex flex-col items-end gap-1"><span className="num text-body-sm font-semibold text-fg">{t.direction === "IN" ? "+" : "−"}{(t.amount_units / 100).toLocaleString("en-PK")}</span>{badge}</span>
    </div>
  );
}

function SendDialog({ user, w, onClose }: { user: string; w: SandboxWallet; onClose: () => void }) {
  const [key] = useState(newIdempotencyKey);
  const sent = useRef(false);
  const [to, setTo] = useState<string>(w.merchants[0]?.id || "addr");
  const [addr, setAddr] = useState("");
  const [name, setName] = useState("");
  const [amt, setAmt] = useState("");
  const units = Math.round(Number(amt) * 100);
  const external = to === "addr";
  const needsName = external && units >= w.limits.travel_rule_units;
  const err = !amt ? null : !(units > 0) ? "Enter an amount" : units > w.spendable_units! ? `You have ${tok(w.spendable_units!)} confirmed` : units > w.limits.per_transfer_units ? `Up to ${tok(w.limits.per_transfer_units)} per transfer` : null;
  const act = useAction(async () => (await call<Transfer>(user, "/v1/sandbox/transfers", { method: "POST", idempotencyKey: key,
    body: JSON.stringify(external ? { to_address: addr.trim().toLowerCase(), amount_units: units, beneficiary_name: name || null } : { merchant_id: to, amount_units: units }) })).data,
    { success: (t) => t.status === "PENDING" ? "Sent to the sandbox chain. It counts once confirmed." : t.status === "BLOCKED" ? "Blocked: that address is on the screening list" : `Not sent: ${t.reason}`, onDone: onClose });
  return (
    <Dialog open onClose={onClose} title="Pay with test tokens" description="Sandbox only. No value moves."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={act.isPending} disabled={!units || !!err || (external && !addr) || (needsName && !name.trim())}
        onClick={() => { if (sent.current) return; sent.current = true; act.mutate(undefined, { onError: () => { sent.current = false; } }); }}>Send</Button></>}>
      <div className="space-y-3">
        <fieldset><legend className="mb-1.5 text-label text-fg">To</legend>
          <div className="space-y-1.5">
            {w.merchants.map((m) => <label key={m.id} className="flex items-center gap-2 text-body-sm text-fg"><input type="radio" name="to" checked={to === m.id} onChange={() => setTo(m.id)} className="accent-[rgb(var(--brand))]" />{m.name} <span className="text-caption text-fg-muted">(merchant)</span></label>)}
            <label className="flex items-center gap-2 text-body-sm text-fg"><input type="radio" name="to" checked={external} onChange={() => setTo("addr")} className="accent-[rgb(var(--brand))]" />Another address</label>
          </div>
        </fieldset>
        {external && <Input label="Address" size2="md" placeholder="0x…" value={addr} onChange={(e) => setAddr(e.target.value)} />}
        <Input label="Amount (test tokens)" size2="md" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ""))} error={err} />
        {needsName && <Input label="Beneficiary name (travel rule)" size2="md" value={name} onChange={(e) => setName(e.target.value)} hint={`Required for transfers to other addresses of ${tok(w.limits.travel_rule_units)} or more.`} />}
      </div>
    </Dialog>
  );
}
