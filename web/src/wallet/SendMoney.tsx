// Send money to any bank account or wallet in Pakistan. Pick the bank, enter the account number or IBAN, see the
// account holder's name (title fetch), then slide to send. The bank directory is SIMULATED: only synthetic test
// accounts exist, no real bank is contacted, and the money path is the same one QR payments use.
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, BadgeCheck, Building2, Lock, Search, ShieldCheck, Wallet as WalletIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Card, IconButton, Input, KV, Skeleton, pkr } from "../ds/ui";
import { ApiError, call, newIdempotencyKey } from "../lib/api";
import { useApi } from "../lib/hooks";
import { useWallet } from "./Home";
import { SlideToPay } from "./Review";

interface Bank { code: string; name: string; short: string; kind: "BANK" | "WALLET" }
interface Banks { banks: Bank[]; purposes: string[]; demo_accounts: { bank: string; account: string; title: string; bank_name: string }[]; directory: string }
interface Title { bank_code: string; bank_name: string; account_masked: string; title: string; fetch_ref: string }

const QUICK = [500, 1000, 2500, 5000];

export default function SendMoney({ user }: { user: string }) {
  const nav = useNavigate();
  const meta = useApi<Banks>(user, "/v1/banks");
  const w = useWallet(user);
  const [bank, setBank] = useState<Bank | null>(null);
  const [q, setQ] = useState("");
  const [acct, setAcct] = useState("");
  const [title, setTitle] = useState<Title | null>(null);
  const [fetching, setFetching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rupees, setRupees] = useState("");
  const [purpose, setPurpose] = useState("Family support");
  const [busy, setBusy] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);

  const amountMinor = Math.round(Number(rupees || "0") * 100);
  const avail = w.data?.available_balance.minor;
  const short = avail != null && amountMinor > avail;
  // One key per intent: the same bank, account and amount reuse it, so a retry can never send twice.
  const key = useMemo(() => newIdempotencyKey(), [title?.fetch_ref, amountMinor, purpose]);   // eslint-disable-line react-hooks/exhaustive-deps

  const pickBank = (b: Bank) => { setBank(b); setTitle(null); setErr(null); };
  const fetchTitle = async (code = bank?.code, number = acct) => {
    if (!code) return;
    setFetching(true); setErr(null); setTitle(null);
    try { setTitle((await call<Title>(user, "/v1/transfers/title-fetch", { method: "POST", body: JSON.stringify({ bank_code: code, account: number }) })).data); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Couldn't reach the bank directory. Try again."); }
    finally { setFetching(false); }
  };
  const pickDemo = (d: Banks["demo_accounts"][number]) => {
    const b = meta.data?.banks.find((x) => x.code === d.bank) || null;
    setBank(b); setAcct(d.account); fetchTitle(d.bank, d.account);
  };
  const send = async () => {
    if (!title) return;
    setBusy(true); setSendErr(null);
    try {
      const r = await call<{ txn_ref: string }>(user, "/v1/transfers", { method: "POST", idempotencyKey: key,
        body: JSON.stringify({ bank_code: title.bank_code, account: acct, amount_minor: amountMinor, purpose }) });
      nav(`/app/txn/${r.data.txn_ref}`, { replace: true });
    } catch (e) {
      setSendErr(e instanceof ApiError ? e.message : "The connection dropped. It's safe to try again: the same transfer can never be sent twice.");
      setBusy(false);
    }
  };

  const banks = (meta.data?.banks || []).filter((b) => !q || (b.name + b.short).toLowerCase().includes(q.toLowerCase()));
  const demos = (meta.data?.demo_accounts || []).filter((d) => !bank || d.bank === bank.code);

  return (
    <div className="safe-top flex min-h-full flex-col px-5 pb-6">
      <div className="flex items-center gap-2 pt-2">
        <IconButton label="Back" onClick={() => (bank && !title ? setBank(null) : nav(-1))}><ArrowLeft className="h-5 w-5" /></IconButton>
        <h1 className="text-title-2 text-fg">Send to a bank</h1>
      </div>
      <p className="mt-1 text-caption text-fg-2">Any bank or wallet in Pakistan, over Raast. Simulated bank directory: test accounts only.</p>

      <AnimatePresence mode="wait" initial={false}>
        {!bank ? (
          <motion.div key="banks" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="mt-5">
            <label className="flex h-12 items-center gap-2 rounded-md border border-line-control bg-surface px-3 focus-within:border-focus">
              <Search className="h-4 w-4 text-fg-muted" aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search banks and wallets" aria-label="Search banks and wallets"
                className="h-full flex-1 bg-transparent text-body text-fg outline-none placeholder:text-fg-muted" />
            </label>
            {meta.isLoading ? <Skeleton className="mt-4 h-64" /> : (
              ["BANK", "WALLET"].map((kind) => {
                const list = banks.filter((b) => b.kind === kind);
                if (!list.length) return null;
                return (
                  <div key={kind} className="mt-5">
                    <p className="text-overline uppercase text-fg-muted">{kind === "BANK" ? "Banks" : "Mobile wallets"}</p>
                    <Card className="mt-2 divide-y divide-line overflow-hidden">
                      {list.map((b) => (
                        <button key={b.code} onClick={() => pickBank(b)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover">
                          <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sunken text-fg-2">
                            {b.kind === "BANK" ? <Building2 className="h-4 w-4" /> : <WalletIcon className="h-4 w-4" />}</span>
                          <span className="flex-1 text-body text-fg">{b.name}</span>
                          <span className="ref text-[11px] text-fg-muted">{b.code}</span>
                        </button>
                      ))}
                    </Card>
                  </div>
                );
              })
            )}
            {meta.data && (
              <div className="mt-6">
                <p className="text-overline uppercase text-fg-muted">Demo accounts (synthetic), tap one</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {meta.data.demo_accounts.map((d) => (
                    <button key={d.bank + d.account} onClick={() => pickDemo(d)} className="rounded-full border border-line bg-raised px-2.5 py-1 text-caption text-fg-2 hover:bg-hover">
                      <span className="font-semibold text-fg">{d.title}</span> · {d.bank_name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div key="details" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} className="mt-5 flex flex-1 flex-col">
            <Card className="p-4">
              <button onClick={() => setBank(null)} className="flex w-full items-center gap-3 text-left">
                <span aria-hidden className="grid h-10 w-10 place-items-center rounded-full bg-night text-night-fg">
                  {bank.kind === "BANK" ? <Building2 className="h-5 w-5" /> : <WalletIcon className="h-5 w-5" />}</span>
                <span className="flex-1"><span className="block text-caption text-fg-2">To</span><span className="block text-body font-semibold text-fg">{bank.name}</span></span>
                <span className="text-caption text-brand-accent">Change</span>
              </button>
              <div className="mt-4">
                <Input label={bank.kind === "WALLET" ? "Account or mobile-linked account number" : "Account number or IBAN"} value={acct}
                  onChange={(e) => { setAcct(e.target.value.toUpperCase().replace(/[^0-9A-Z ]/g, "")); setTitle(null); setErr(null); }}
                  hint="10–16 digits, or the 24-character IBAN starting with PK. Test accounts start with 99." error={err} />
              </div>
              {demos.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {demos.map((d) => (
                    <button key={d.account} onClick={() => pickDemo(d)} className="rounded-full border border-line bg-raised px-2.5 py-1 text-caption text-fg-2 hover:bg-hover">
                      <span className="ref font-semibold text-fg">{d.account}</span> · {d.title}
                    </button>
                  ))}
                </div>
              )}
              {!title && <Button className="mt-4" block variant="secondary" loading={fetching} disabled={acct.replace(/\s/g, "").length < 10} onClick={() => fetchTitle()}>Fetch account title</Button>}
              {title && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-md border border-success-line bg-success-soft p-3.5">
                  <p className="flex items-center gap-1.5 text-caption text-success"><BadgeCheck className="h-4 w-4" aria-hidden />Account title (simulated directory)</p>
                  <p className="mt-1 font-display text-title-3 text-fg">{title.title}</p>
                  <p className="text-caption text-fg-2">{title.bank_name} · <span className="ref">{title.account_masked}</span></p>
                </motion.div>
              )}
            </Card>

            {title && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 flex flex-1 flex-col">
                <Card className="p-4">
                  <Input label="Amount (Rs)" inputMode="numeric" value={rupees} onChange={(e) => setRupees(e.target.value.replace(/\D/g, "").slice(0, 7))} />
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {QUICK.map((v) => <button key={v} onClick={() => setRupees(String(v))} className={`rounded-md border py-2 text-body-sm ${Number(rupees) === v ? "border-brand bg-brand-soft text-fg" : "border-line text-fg-2 hover:bg-hover"}`}>{v.toLocaleString("en-US")}</button>)}
                  </div>
                  <label className="mt-4 block text-label text-fg">Purpose
                    <select value={purpose} onChange={(e) => setPurpose(e.target.value)} className="mt-1.5 h-12 w-full rounded-md border border-line-control bg-surface px-3 text-body text-fg">
                      {(meta.data?.purposes || []).map((p) => <option key={p}>{p}</option>)}
                    </select>
                  </label>
                </Card>
                <Card className="mt-4 px-4 py-2">
                  <dl>
                    <KV k="Available now" v={avail != null ? pkr(avail) : "—"} />
                    <KV k="After this transfer" v={avail != null && amountMinor ? pkr(avail - amountMinor) : "—"} />
                    <KV k="Fee" v="Rs 0" />
                    <KV k="Network" v="Raast P2P (simulated)" />
                  </dl>
                </Card>
                <p className="mt-3 flex items-start gap-2 text-caption text-fg-2"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-accent" aria-hidden />
                  Check the name above. Money leaves only after the same risk checks as a shop payment, and shows "Paid" only when Raast confirms.</p>
                <div className="flex-1" />
                <div className="mt-5 space-y-3">
                  {sendErr && <Alert tone="danger" title="Transfer not sent">{sendErr}</Alert>}
                  {short && <Alert tone="warning" title="Not enough available balance">You need {pkr(amountMinor - avail!)} more.</Alert>}
                  <SlideToPay disabled={!amountMinor || short || busy} busy={busy} amount={amountMinor ? pkr(amountMinor) : ""} onConfirm={send} verb="send" />
                  <p className="flex items-center justify-center gap-1.5 text-caption text-fg-muted"><Lock className="h-3 w-3" aria-hidden />Slide, or focus the control and press Enter, to send</p>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
