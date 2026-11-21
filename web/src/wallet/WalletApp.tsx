// Paya Wallet: the customer (and cashier) phone experience. Light, calm, mobile-first.
import { AnimatePresence, motion } from "framer-motion";
import { Home, ListOrdered, ScanLine, UserRound } from "lucide-react";
import { useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { dur, ease } from "../ds/motion";
import { cx } from "../ds/ui";
import { forget, session } from "../lib/api";
import { useTheme } from "../lib/hooks";
import Account from "./Account";
import Activity from "./Activity";
import Cashier from "./Cashier";
import HomeScreen from "./Home";
import Onboarding from "./Onboarding";
import Review from "./Review";
import Scan from "./Scan";
import SignIn from "./SignIn";
import Txn from "./Txn";

const KEY = "paya.appUser";
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (v: string | null) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* private mode */ } };

export default function WalletApp() {
  useTheme("wallet");
  const loc = useLocation();
  const nav = useNavigate();
  const [user, setUser] = useState<string | null>(read());
  const s = user ? session(user) : undefined;
  const signIn = (u: string) => { write(u); setUser(u); nav("/app", { replace: true }); };
  const signOut = () => { if (user) forget(user); write(null); setUser(null); nav("/app", { replace: true }); };

  if (loc.pathname.startsWith("/app/open")) return <Onboarding onDone={signIn} />;
  if (!user || !s) return <SignIn onSignedIn={signIn} />;
  if (s.role === "CASHIER" || s.role === "MERCHANT_ADMIN") return <Cashier user={user} onSignOut={signOut} />;
  if (s.role !== "CUSTOMER") return <SignIn onSignedIn={signIn} notice="Staff accounts use Mission Control, not the wallet." />;

  const hideNav = /^\/app\/(pay\/|txn\/)/.test(loc.pathname);
  return (
    <div className="mx-auto flex h-full max-w-[480px] flex-col bg-canvas">
      <a href="#wallet-main" className="sr-only-focusable absolute left-2 top-2 z-50 rounded bg-surface px-3 py-2 text-label">Skip to content</a>
      <main id="wallet-main" className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={loc.pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { duration: dur.base, ease: ease.enter } }}
            exit={{ opacity: 0, transition: { duration: dur.instant } }} className="min-h-full">
            <Routes location={loc}>
              <Route index element={<HomeScreen user={user} />} />
              <Route path="activity" element={<Activity user={user} />} />
              <Route path="scan" element={<Scan user={user} />} />
              <Route path="pay/:prId" element={<Review user={user} />} />
              <Route path="txn/:ref" element={<Txn user={user} />} />
              <Route path="account" element={<Account user={user} onSignOut={signOut} />} />
              <Route path="*" element={<Navigate to="/app" replace />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </main>
      {!hideNav && <TabBar />}
    </div>
  );
}

function TabBar() {
  const nav = useNavigate();
  const tab = (to: string, Icon: any, label: string, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => cx("relative flex flex-1 flex-col items-center gap-1 py-2 text-[11.5px] font-medium transition-colors duration-fast",
      isActive ? "text-fg" : "text-fg-muted hover:text-fg-2")}>
      {({ isActive }) => (<>
        <Icon className="h-5 w-5" strokeWidth={isActive ? 2.4 : 1.9} aria-hidden />{label}
        {isActive && <motion.span layoutId="tab-dot" className="absolute -top-px h-0.5 w-6 rounded-full bg-brand" />}
      </>)}
    </NavLink>
  );
  return (
    <nav aria-label="Wallet" className="safe-bottom border-t border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-[480px] items-end px-2 pt-1">
        {tab("/app", Home, "Home", true)}
        {tab("/app/activity", ListOrdered, "Activity")}
        <div className="flex flex-1 justify-center">
          <motion.button whileTap={{ scale: 0.94 }} onClick={() => nav("/app/scan")} aria-label="Scan to pay"
            className="-mt-5 grid h-14 w-14 place-items-center rounded-2xl bg-brand text-brand-fg shadow-e2">
            <ScanLine className="h-6 w-6" aria-hidden />
          </motion.button>
        </div>
        {tab("/app/account", UserRound, "Account")}
      </div>
    </nav>
  );
}
