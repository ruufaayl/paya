import { AnimatePresence, motion } from "framer-motion";
import { Home, LogOut, ScanLine, Store, UserPlus } from "lucide-react";
import { useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Logo, Spinner } from "../../components/ui";
import { ApiError, login, session } from "../../lib/api";
import Cashier from "./Cashier";
import Onboarding from "./Onboarding";
import CustomerHome from "./CustomerHome";
import Pay from "./Pay";
import Scan from "./Scan";
import TxnLive from "./TxnLive";

const KEY = "paya.appUser";
const get = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const set = (v: string | null) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* */ } };

export const PERSONAS = [
  { username: "sara", name: "Sara Ahmed", role: "Customer", note: "Verified, Tier 2 wallet", color: "from-paya-400 to-emerald-700" },
  { username: "omar", name: "Omar Farooq", role: "Customer", note: "Tier 1 - Rs 25,000 limit", color: "from-sky-400 to-blue-700" },
  { username: "zarak", name: "Zarak Khanzada", role: "Customer", note: "Triggers a watch-list hold", color: "from-amber-400 to-orange-700" },
  { username: "hina", name: "Hina Baig", role: "Customer", note: "KYC not yet verified", color: "from-violet-400 to-purple-700" },
  { username: "ayesha.cashier", name: "Ayesha", role: "Cashier", note: "Chai Junction till", color: "from-rose-400 to-pink-700" },
  { username: "kamran.cashier", name: "Kamran", role: "Cashier", note: "Shifa Pharmacy till", color: "from-teal-400 to-cyan-700" },
];

export default function PhoneApp() {
  const [user, setUser] = useState<string | null>(get());
  const loc = useLocation();
  const nav = useNavigate();
  const signOut = () => { set(null); setUser(null); };
  // A wallet opened through onboarding is a real (synthetic) customer, not one of the seeded personas.
  const own = user ? session(user) : undefined;
  const persona = PERSONAS.find((p) => p.username === user) ||
    (own && own.role === "CUSTOMER" ? { username: own.username, name: own.display_name, role: "Customer", note: "New wallet", color: "from-paya-300 to-teal-600" } : undefined);

  if (loc.pathname.startsWith("/app/open")) return <Onboarding onDone={(u) => { set(u); setUser(u); nav("/app"); }} />;
  if (!user || !persona) return <PersonaPicker onPick={(u) => { set(u); setUser(u); }} />;
  const isCashier = persona.role === "Cashier";

  return (
    <div className="mx-auto flex h-full max-w-md flex-col bg-ink-950">
      <div className="safe-top flex items-center justify-between px-5 pb-2">
        <Logo size={26} />
        <button onClick={signOut} className="flex items-center gap-2 rounded-full bg-white/5 py-1.5 pl-1.5 pr-3 ring-1 ring-white/10">
          <span className={`grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br ${persona.color} text-xs font-bold text-ink-950`}>
            {persona.name[0]}
          </span>
          <span className="text-xs text-slate-300">{persona.name.split(" ")[0]}</span>
          <LogOut size={13} className="text-slate-500" />
        </button>
      </div>
      <div id="app-scroll" className="relative flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
        {isCashier ? (
          <Cashier user={user} />
        ) : (
          <Routes>
            <Route index element={<CustomerHome user={user} />} />
            <Route path="scan" element={<Scan user={user} />} />
            <Route path="pay/:prId" element={<Pay user={user} />} />
            <Route path="txn/:ref" element={<TxnLive user={user} />} />
          </Routes>
        )}
      </div>
      {!isCashier && <TabBar />}
    </div>
  );
}

function TabBar() {
  const nav = useNavigate();
  const tab = (to: string, Icon: any, label: string) => (
    <NavLink to={to} end className={({ isActive }) => `flex flex-1 flex-col items-center gap-1 py-1 text-[11px] ${isActive ? "text-paya-300" : "text-slate-500"}`}>
      <Icon size={20} /> {label}
    </NavLink>
  );
  return (
    <div className="safe-bottom glass relative mx-3 mb-3 flex items-center rounded-3xl px-2 pt-2">
      {tab("/app", Home, "Home")}
      <motion.button whileTap={{ scale: 0.92 }} onClick={() => nav("/app/scan")}
        className="-mt-9 grid h-16 w-16 place-items-center rounded-[22px] bg-gradient-to-br from-paya-300 to-paya-600 text-ink-950 shadow-glow">
        <ScanLine size={26} />
      </motion.button>
      {tab("/app/scan", Store, "Pay a shop")}
    </div>
  );
}

function PersonaPicker({ onPick }: { onPick: (u: string) => void }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pick = async (u: string) => {
    setBusy(u); setErr(null);
    try { await login(u); onPick(u); } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Cannot reach the Paya server. Set its URL on the start page.");
    } finally { setBusy(null); }
  };
  return (
    <div className="aurora min-h-full">
      <div className="safe-top mx-auto max-w-md px-5 pb-10">
        <div className="pt-6"><Logo size={36} /></div>
        <h1 className="mt-8 text-3xl font-extrabold tracking-tight">Who's using Paya?</h1>
        <p className="mt-2 text-sm text-slate-400">Synthetic demo people. Each one exercises a different path through the system.</p>
        <div className="mt-6 grid gap-3">
          <AnimatePresence>
            {PERSONAS.map((p, i) => (
              <motion.button key={p.username} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                whileTap={{ scale: 0.98 }} onClick={() => pick(p.username)}
                className="card flex items-center gap-4 p-4 text-left">
                <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br ${p.color} text-lg font-extrabold text-ink-950`}>{p.name[0]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{p.name}</span>
                  <span className="block text-xs text-slate-400">{p.role} - {p.note}</span>
                </span>
                {busy === p.username ? <Spinner /> : <span className="text-xs text-slate-500">{p.role === "Cashier" ? "Till" : "Wallet"}</span>}
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
        <motion.button whileTap={{ scale: 0.98 }} onClick={() => nav("/app/open")}
          className="mt-4 flex w-full items-center gap-4 rounded-3xl border border-dashed border-paya-400/40 bg-paya-400/[0.06] p-4 text-left">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-paya-400 text-ink-950"><UserPlus size={22} /></span>
          <span className="flex-1">
            <span className="block font-semibold text-paya-200">Open a new Paya wallet</span>
            <span className="block text-xs text-slate-400">Digital onboarding: specimen ID, selfie liveness, instant decision</span>
          </span>
        </motion.button>
        {err && <p className="mt-4 rounded-2xl bg-rose-500/10 p-3 text-sm text-rose-300 ring-1 ring-rose-500/30">{err}</p>}
      </div>
    </div>
  );
}
