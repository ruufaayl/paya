// Sign in: demo accounts (synthetic people, each exercising a different path) or a wallet opened via onboarding.
import { motion } from "framer-motion";
import { ArrowRight, ChevronRight, FlaskConical, Store, UserPlus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { fadeUp, stagger } from "../ds/motion";
import { Alert, Button, Card, Input, Logo } from "../ds/ui";
import { ServerStatus } from "../ds/server";
import { ApiError, DEMO_PASSWORD, login } from "../lib/api";

const DEMO = [
  { username: "sara", name: "Sara Ahmed", note: "Verified, tier 2", path: "Everyday payments" },
  { username: "omar", name: "Omar Farooq", note: "Tier 1, Rs 25,000 limit", path: "Limits" },
  { username: "zarak", name: "Zarak Khanzada", note: "Possible watch-list match", path: "Compliance hold" },
  { username: "hina", name: "Hina Baig", note: "Not yet verified", path: "KYC refusal" },
];
const TILLS = [
  { username: "ayesha.cashier", name: "Ayesha", note: "Chai Junction till" },
  { username: "kamran.cashier", name: "Kamran", note: "Shifa Pharmacy till" },
  { username: "noor.cashier", name: "Noor", note: "Green Leaf Grocers till" },
  { username: "danish.cashier", name: "Danish", note: "Lahore Tikka House till" },
  { username: "sadia.cashier", name: "Sadia", note: "Clifton Fuel Stop till" },
  { username: "imran.cashier", name: "Imran", note: "Saddar Book Corner till" },
];

export default function SignIn({ onSignedIn, notice }: { onSignedIn: (u: string) => void; notice?: string }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(notice || null);
  const [form, setForm] = useState({ username: "", password: "" });

  const go = async (u: string, pw = DEMO_PASSWORD) => {
    setBusy(u); setErr(null);
    try { await login(u, pw); onSignedIn(u); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Cannot reach the Rupay server. Check the server address below."); }
    finally { setBusy(null); }
  };

  return (
    <div className="min-h-full bg-canvas">
      <div className="safe-top mx-auto max-w-[480px] px-5 pb-10">
        <div className="pt-4"><Logo size={30} /></div>
        <motion.div variants={stagger(0.05)} initial="hidden" animate="show">
          <motion.h1 variants={fadeUp} className="mt-10 font-display text-display text-fg">Dedo <span className="text-brand-accent">mujhay!</span></motion.h1>
          <motion.p variants={fadeUp} className="mt-2 text-body text-fg-2">A wallet where "paid" means the ledger and Raast both agree.</motion.p>

          <motion.div variants={fadeUp} className="mt-6">
            <Button size="lg" block icon={<UserPlus className="h-5 w-5" />} onClick={() => nav("/app/open")}>Open a new Rupay wallet</Button>
          </motion.div>

          <motion.form variants={fadeUp} className="mt-6 space-y-3" onSubmit={(e) => { e.preventDefault(); go(form.username.trim().toLowerCase(), form.password); }}>
            <p className="text-label text-fg-2">Already opened one? Sign in</p>
            <Input label="Username" autoCapitalize="none" autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            <Input label="Password" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <Button type="submit" variant="secondary" size="lg" block loading={busy === form.username.trim().toLowerCase()} disabled={!form.username || !form.password}>Sign in <ArrowRight className="h-4 w-4" /></Button>
          </motion.form>

          {err && <div className="mt-4"><Alert tone="danger" title="Couldn't sign in">{err}</Alert></div>}
          <motion.div variants={fadeUp} className="mt-4"><ServerStatus compact /></motion.div>

          <motion.section variants={fadeUp} className="mt-9" aria-labelledby="demo-h">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-fg-muted" aria-hidden />
              <h2 id="demo-h" className="text-overline uppercase text-fg-muted">Demo accounts · synthetic people</h2>
            </div>
            <Card className="mt-3 divide-y divide-line overflow-hidden">
              {DEMO.map((p) => (
                <button key={p.username} onClick={() => go(p.username)} disabled={!!busy}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover disabled:opacity-60">
                  <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sunken font-display text-body font-bold text-fg">{p.name[0]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-semibold text-fg">{p.name}</span>
                    <span className="block truncate text-caption text-fg-2">{p.note} · shows: {p.path}</span>
                  </span>
                  {busy === p.username ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-fg-muted border-t-transparent" /> : <ChevronRight className="h-4 w-4 text-fg-muted" aria-hidden />}
                </button>
              ))}
            </Card>
            <h2 className="mt-6 flex items-center gap-2 text-overline uppercase text-fg-muted"><Store className="h-4 w-4" aria-hidden /> Merchant tills</h2>
            <Card className="mt-3 divide-y divide-line overflow-hidden">
              {TILLS.map((p) => (
                <button key={p.username} onClick={() => go(p.username)} disabled={!!busy}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover disabled:opacity-60">
                  <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-night text-body font-bold text-night-fg">{p.name[0]}</span>
                  <span className="min-w-0 flex-1"><span className="block text-body font-semibold text-fg">{p.name}</span><span className="block text-caption text-fg-2">{p.note}</span></span>
                  <ChevronRight className="h-4 w-4 text-fg-muted" aria-hidden />
                </button>
              ))}
            </Card>
            <p className="mt-6 text-caption text-fg-muted">Prototype for FAST CS3017. Synthetic data, simulated Raast rail, no real money. Demo password: {DEMO_PASSWORD}.</p>
          </motion.section>
        </motion.div>
      </div>
    </div>
  );
}
