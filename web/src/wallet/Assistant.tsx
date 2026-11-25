// Rupay Assistant: conversational banking that answers from the customer's own ledger. It cannot move money:
// action cards only link into the normal, confirmed flows. Replies and cards come from the server.
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Bot, Info, SendHorizontal, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { paymentMeta } from "../ds/status";
import { Alert, Badge, IconButton, Money, Ref, StatusBadge, cx, pkr } from "../ds/ui";
import { ApiError, call } from "../lib/api";

interface Card { type: "balance" | "txn" | "action"; [k: string]: any }
interface Reply { conversation_ref: string; intent: string; reply: string; cards: Card[]; suggestions: string[]; handoff: { case_ref: string } | null; redacted: string[] }
interface Msg { id: number; role: "user" | "assistant"; text: string; cards?: Card[]; handoff?: Reply["handoff"]; redacted?: string[] }

const KEY = "paya.chat";
const START = ["What's my balance?", "Did my last payment go through?", "mera balance kitna hai", "Talk to a person"];

export default function Assistant({ user }: { user: string }) {
  const nav = useNavigate();
  const [msgs, setMsgs] = useState<Msg[]>(() => { try { return JSON.parse(sessionStorage.getItem(`${KEY}.${user}`) || "[]"); } catch { return []; } });
  const [ref, setRef] = useState<string | null>(() => { try { return sessionStorage.getItem(`${KEY}.ref.${user}`); } catch { return null; } });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>(START);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const seq = useRef(msgs.length);
  useEffect(() => { try { sessionStorage.setItem(`${KEY}.${user}`, JSON.stringify(msgs.slice(-40))); if (ref) sessionStorage.setItem(`${KEY}.ref.${user}`, ref); } catch { /* */ } end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, ref, user]);

  const send = async (t: string) => {
    const body = t.trim();
    if (!body || busy) return;
    setErr(null); setText(""); setBusy(true);
    setMsgs((m) => [...m, { id: ++seq.current, role: "user", text: body }]);
    try {
      const r = await call<Reply>(user, "/v1/assistant/messages", { method: "POST", body: JSON.stringify({ text: body, conversation_ref: ref }) });
      setRef(r.data.conversation_ref);
      setSuggestions(r.data.suggestions);
      // The user's bubble shows what the server stored (secrets removed), not what was typed.
      setMsgs((m) => [...m.slice(0, -1), { ...m[m.length - 1], redacted: r.data.redacted },
        { id: ++seq.current, role: "assistant", text: r.data.reply, cards: r.data.cards, handoff: r.data.handoff }]);
    } catch (e) { setErr(e instanceof ApiError ? e.message : "The assistant couldn't be reached. Nothing was changed."); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="safe-top flex items-center gap-2 border-b border-line bg-surface px-3 pb-2">
        <IconButton label="Back" onClick={() => nav("/app")}><ArrowLeft className="h-5 w-5" /></IconButton>
        <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-night text-night-fg"><Bot className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-title-3 text-fg">Rupay Assistant</h1>
          <p className="truncate text-caption text-fg-2">Answers from your wallet's ledger · can't move money</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 scrollbar-thin" role="log" aria-live="polite" aria-label="Conversation">
        {msgs.length === 0 && (
          <div className="mx-auto max-w-sm text-center">
            <span aria-hidden className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-night text-night-fg"><Bot className="h-7 w-7" /></span>
            <p className="mt-3 text-title-3 text-fg">Ask about your money</p>
            <p className="mt-1 text-body-sm text-fg-2">Balance, payments and their status, limits and verification. English or Roman Urdu.</p>
            <ul className="mt-4 space-y-1.5 text-left text-caption text-fg-2">
              <li className="flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-success" aria-hidden />It only sees your own wallet, and it can't send or reverse money.</li>
              <li className="flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-success" aria-hidden />Card numbers, CNICs, OTPs and passwords are removed before anything is saved.</li>
              <li className="flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-success" aria-hidden />Ask for a person at any time. Chats are deleted after 30 days.</li>
            </ul>
          </div>
        )}
        <ol className="space-y-3">
          <AnimatePresence initial={false}>
            {msgs.map((m) => (
              <motion.li key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cx("max-w-[86%] space-y-2", m.role === "user" && "items-end")}>
                  <p className={cx("whitespace-pre-wrap rounded-lg px-3.5 py-2.5 text-body",
                    m.role === "user" ? "rounded-br-sm bg-night text-night-fg" : "rounded-bl-sm border border-line bg-surface text-fg")}>
                    <span className="sr-only">{m.role === "user" ? "You said: " : "Assistant said: "}</span>{m.text}
                  </p>
                  {m.redacted && m.redacted.length > 0 && <p className="text-right text-caption text-warning"><Info className="mr-1 inline h-3.5 w-3.5" aria-hidden />Removed before saving: {m.redacted.map((k) => k.toLowerCase()).join(", ")}</p>}
                  {m.cards?.map((c, i) => <ChatCard key={i} c={c} onRoute={(r) => r.startsWith("/app/") && nav(r)} />)}
                  {m.handoff && <Alert tone="review" title={`Passed to our team · ${m.handoff.case_ref}`}>A person from Operations will review this conversation.</Alert>}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
          {busy && <li className="flex gap-1 px-2" aria-label="Assistant is typing">{[0, 1, 2].map((i) => <motion.span key={i} className="h-2 w-2 rounded-full bg-fg-muted" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: i * 0.15 }} />)}</li>}
        </ol>
        <div ref={end} />
      </div>

      <div className="safe-bottom border-t border-line bg-surface px-3 pt-2">
        {err && <div className="mb-2"><Alert tone="danger">{err}</Alert></div>}
        <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-thin" role="group" aria-label="Suggestions">
          {suggestions.map((s) => <button key={s} onClick={() => send(s)} disabled={busy} className="shrink-0 rounded-full border border-line-strong bg-canvas px-3 py-1.5 text-label text-fg hover:bg-hover disabled:opacity-50">{s}</button>)}
        </div>
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <label htmlFor="chat-input" className="sr-only">Message the assistant</label>
          <textarea id="chat-input" rows={1} value={text} maxLength={500} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }}
            placeholder="Ask Rupay…" className="max-h-28 min-h-[44px] flex-1 resize-none rounded-md border border-line-control bg-canvas px-3 py-2.5 text-body text-fg outline-none placeholder:text-fg-muted focus:border-focus" />
          <button type="submit" disabled={!text.trim() || busy} aria-label="Send" className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-brand text-brand-fg disabled:opacity-40"><SendHorizontal className="h-5 w-5" /></button>
        </form>
        <p className="py-1.5 text-center text-[11.5px] text-fg-muted">Never share your PIN, OTP or password. Rupay will never ask for them.</p>
      </div>
    </div>
  );
}

function ChatCard({ c, onRoute }: { c: Card; onRoute: (r: string) => void }) {
  if (c.type === "balance") return (
    <div className="rounded-lg bg-night p-3.5 text-night-fg">
      <p className="text-caption text-night-fg/75">Available to spend</p>
      <p className="num font-display text-title-1">{pkr(c.available_minor)}</p>
      <p className="num text-caption text-night-fg/70">Ledger {pkr(c.ledger_minor)} · reserved {pkr(c.reserved_minor)}</p>
    </div>
  );
  if (c.type === "txn") return (
    <button onClick={() => c.kind === "PAYMENT" && onRoute(`/app/txn/${c.txn_ref}`)} className="flex w-full items-center gap-3 rounded-lg border border-line bg-surface p-3 text-left hover:bg-hover">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-sm font-semibold text-fg">{c.merchant || (c.kind === "TOPUP" ? "Wallet top-up" : c.kind.toLowerCase())}</span>
        <Ref className="text-[11.5px]">{c.txn_ref}</Ref>
      </span>
      <span className="flex flex-col items-end gap-1"><Money minor={c.amount_minor} className="text-body-sm font-semibold text-fg" /><StatusBadge meta={paymentMeta(c.status)} size="sm" /></span>
    </button>
  );
  if (c.type === "action") return (
    <button onClick={() => onRoute(c.route)} className="flex w-full items-center justify-between rounded-lg border border-brand/40 bg-brand-soft px-3.5 py-2.5 text-label font-semibold text-brand-accent">
      {c.label}<ArrowRight className="h-4 w-4" aria-hidden />
    </button>
  );
  return <Badge tone="neutral">{c.type}</Badge>;
}
