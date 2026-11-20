import { motion } from "framer-motion";
import { Activity, ArrowRight, Server, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../components/ui";
import { apiBase, setApiBase } from "../lib/api";

export default function Landing() {
  const [base, setBase] = useState(apiBase());
  const [health, setHealth] = useState<"checking" | "ok" | "down">("checking");
  const appUrl = `${window.location.origin}/app`;

  useEffect(() => {
    setHealth("checking");
    const t = setTimeout(() => {
      fetch(`${base.replace(/\/$/, "")}/healthz`).then((r) => setHealth(r.ok ? "ok" : "down")).catch(() => setHealth("down"));
    }, 300);
    return () => clearTimeout(t);
  }, [base]);

  return (
    <div className="min-h-full aurora">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-14">
        <header className="flex items-center justify-between">
          <Logo size={34} />
          <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-400 ring-1 ring-white/10">Synthetic demo - no real money</span>
        </header>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-12 max-w-3xl">
          <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
            Payment <span className="bg-gradient-to-r from-paya-300 to-sky-400 bg-clip-text text-transparent">pakka</span> hai.
          </h1>
          <p className="mt-5 text-lg text-slate-400">
            Raast QR payments where the cashier sees <b className="text-slate-200">PAID</b> only when the ledger says so -
            and every check, failure and recovery happens in plain sight.
          </p>
        </motion.div>

        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="card p-6">
            <div className="flex items-start justify-between gap-6">
              <div>
                <div className="flex items-center gap-2 text-paya-300"><Smartphone size={18} /> <span className="text-sm font-semibold">Phone app</span></div>
                <h2 className="mt-3 text-2xl font-bold">Pay and get paid</h2>
                <p className="mt-2 text-sm text-slate-400">Scan this with your iPhone camera, then Share &rarr; Add to Home Screen. It opens full-screen like a native app.</p>
                <Link to="/app" className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-paya-400 px-4 py-3 text-sm font-semibold text-ink-950">
                  Open here <ArrowRight size={16} />
                </Link>
              </div>
              <div className="hidden rounded-2xl bg-white p-3 sm:block">
                <QRCodeSVG value={appUrl} size={132} bgColor="#ffffff" fgColor="#05070A" />
              </div>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="card p-6">
            <div className="flex items-center gap-2 text-sky-400"><Activity size={18} /> <span className="text-sm font-semibold">Mission Control</span></div>
            <h2 className="mt-3 text-2xl font-bold">Watch the system think</h2>
            <p className="mt-2 text-sm text-slate-400">A live map of every service. Payments flow along the wires, failures light up, humans approve what machines must not decide.</p>
            <Link to="/control" className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-sky-400 px-4 py-3 text-sm font-semibold text-ink-950">
              Launch on this screen <ArrowRight size={16} />
            </Link>
          </motion.div>
        </div>

        <div className="mt-5 card p-5">
          <div className="flex flex-wrap items-center gap-3">
            <Server size={16} className="text-slate-400" />
            <span className="text-sm text-slate-300">Paya API server</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${health === "ok" ? "text-paya-300 ring-paya-500/40" : health === "down" ? "text-rose-400 ring-rose-500/40" : "text-slate-400 ring-white/10"}`}>
              {health === "ok" ? "connected" : health === "down" ? "unreachable" : "checking"}
            </span>
            <input value={base} onChange={(e) => { setBase(e.target.value); setApiBase(e.target.value); }}
              className="min-w-0 flex-1 rounded-xl bg-ink-850 px-3 py-2 font-mono text-xs text-slate-200 ring-1 ring-white/10 outline-none focus:ring-paya-500/50"
              placeholder="https://your-tunnel.trycloudflare.com" />
          </div>
          <p className="mt-2 text-xs text-slate-500">Running the backend on your laptop? Expose it with a free HTTPS tunnel and paste the URL here (saved on this device).</p>
        </div>
      </div>
    </div>
  );
}
