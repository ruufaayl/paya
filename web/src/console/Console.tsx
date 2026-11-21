// Paya Mission Control: a financial-operations console. Every number is read from the backend; every action is
// performed as the signed-in operator and checked by the server.
import {
  Activity, ArrowLeftRight, Bot, ChevronDown, FileCheck2, FlaskConical, Gauge, LogOut, Menu, Network, Radio, Search,
  ShieldCheck, ScrollText, UserCheck, UserRoundCog, Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { Badge, Button, Card, Dot, Logo, Spinner, cx } from "../ds/ui";
import { ApiError } from "../lib/api";
import { useApi, useTheme } from "../lib/hooks";
import { CaseInspector, KycInspector, TxnInspector } from "./inspectors";
import { OP_KEY, OperatorProvider, STAFF, StreamProvider, loadOperator, useCan, useLive, useOperator, type Operator } from "./core";
import AiOps from "./pages/AiOps";
import Audit from "./pages/Audit";
import Cases from "./pages/Cases";
import Events from "./pages/Events";
import Kyc from "./pages/Kyc";
import Overview from "./pages/Overview";
import RailLab from "./pages/RailLab";
import Recon from "./pages/Recon";
import Topology from "./pages/Topology";
import Transactions from "./pages/Transactions";

interface NavItem { to: string; label: string; icon: any; perm: string; end?: boolean; badge?: "cases" | "kyc" }
const NAV: { group: string; items: NavItem[] }[] = [
  { group: "Monitor", items: [
    { to: "/control", label: "Overview", icon: Gauge, end: true, perm: "backoffice:read" },
    { to: "/control/transactions", label: "Transactions", icon: ArrowLeftRight, perm: "backoffice:read" },
    { to: "/control/topology", label: "System topology", icon: Network, perm: "backoffice:read" },
    { to: "/control/events", label: "Event stream", icon: Activity, perm: "backoffice:read" },
  ] },
  { group: "Work", items: [
    { to: "/control/cases", label: "Cases & approvals", icon: UserCheck, perm: "cases:read", badge: "cases" },
    { to: "/control/kyc", label: "Identity & KYC", icon: ShieldCheck, perm: "kyc:read", badge: "kyc" },
    { to: "/control/recon", label: "Reconciliation", icon: FileCheck2, perm: "backoffice:read" },
    { to: "/control/ai", label: "AI operations", icon: Bot, perm: "backoffice:read" },
  ] },
  { group: "Control", items: [
    { to: "/control/rail-lab", label: "Rail lab", icon: FlaskConical, perm: "backoffice:read" },
    { to: "/control/audit", label: "Audit & access", icon: ScrollText, perm: "audit:read" },
  ] },
];

export default function Console() {
  useTheme("console");
  const [op, setOp] = useState<Operator | null>(null);
  const [booting, setBooting] = useState(true);
  useEffect(() => {
    let u: string | null = null;
    try { u = localStorage.getItem(OP_KEY); } catch { /* */ }
    if (!u) { setBooting(false); return; }
    loadOperator(u).then(setOp).catch(() => undefined).finally(() => setBooting(false));
  }, []);
  if (booting) return <div className="grid h-full place-items-center bg-canvas"><Spinner className="h-6 w-6" /></div>;
  if (!op) return <OperatorGate onReady={setOp} />;
  return (
    <OperatorProvider op={op} setOp={setOp}>
      <StreamProvider as={op.username}>
        <Shell />
      </StreamProvider>
    </OperatorProvider>
  );
}

function OperatorGate({ onReady }: { onReady: (o: Operator) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pick = async (u: string) => {
    setBusy(u); setErr(null);
    try {
      const o = await loadOperator(u);
      if (!o.permissions.includes("backoffice:read") && !o.permissions.includes("cases:read")) {
        setErr(`${u} (${o.role}) has no back-office access. The server refuses it, so the console does too.`); return;
      }
      try { localStorage.setItem(OP_KEY, u); } catch { /* */ }
      onReady(o);
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Cannot reach the Paya server."); } finally { setBusy(null); }
  };
  useEffect(() => { document.title = "Sign in · Paya Mission Control"; }, []);
  return (
    <div className="grid min-h-full place-items-center bg-canvas p-6 grid-dots">
      <Card className="w-full max-w-[520px] p-6 shadow-e3">
        <Logo size={28} suffix="Mission Control" />
        <h1 className="mt-6 font-display text-title-1 text-fg">Who is operating?</h1>
        <p className="mt-1 text-body-sm text-fg-2">Sign in as a synthetic staff member. Every action runs as that person, and the server checks their role. Switch at any time from the top bar.</p>
        <ul className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {STAFF.map((s) => (
            <li key={s.username}>
              <button onClick={() => pick(s.username)} disabled={!!busy}
                className="flex w-full items-center gap-3 rounded-md border border-line bg-raised px-3 py-2.5 text-left transition-colors hover:border-line-strong hover:bg-hover disabled:opacity-60">
                <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-sunken font-display text-body-sm font-bold text-fg">{s.name[0]}</span>
                <span className="min-w-0 flex-1"><span className="block text-body-sm font-semibold text-fg">{s.name}</span><span className="block truncate text-caption text-fg-2">{s.title}</span></span>
                {busy === s.username && <Spinner />}
              </button>
            </li>
          ))}
        </ul>
        <button onClick={() => pick("ayesha.cashier")} className="mt-3 text-caption text-fg-2 underline-offset-2 hover:underline">Try a non-staff account (cashier) to see the refusal</button>
        {err && <p role="alert" className="mt-3 rounded-md border border-danger-line bg-danger-soft p-3 text-body-sm text-danger">{err}</p>}
        <p className="mt-5 border-t border-line pt-4 text-caption text-fg-muted">Synthetic data · simulated Raast rail and identity registry · no real money. Demo password for every account: paya-demo-2026.</p>
      </Card>
    </div>
  );
}

function Shell() {
  const [collapsed, setCollapsed] = useState(false);
  const can = useCan();
  const { op } = useOperator();
  const counts = useApi<any>(op.username, can("backoffice:read") ? "/v1/ops/overview" : null, { refetchInterval: 5000 });
  const hw = counts.data?.human_work;
  const badge = (k?: string) => k === "cases" ? (hw ? Object.values(hw.open_cases || {}).reduce((a: number, b: any) => a + b, 0) + (hw.approvals_waiting || 0) : 0) : k === "kyc" ? hw?.kyc_referred || 0 : 0;

  return (
    <div className="flex h-full bg-canvas text-fg">
      <a href="#console-main" className="sr-only-focusable absolute left-2 top-2 z-50 rounded bg-surface px-3 py-2 text-label">Skip to content</a>
      <aside aria-label="Mission Control navigation" className={cx("flex shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-base", collapsed ? "w-[64px]" : "w-[232px]")}>
        <div className={cx("flex h-14 items-center border-b border-line", collapsed ? "justify-center" : "px-4")}>
          {collapsed ? <Logo size={26} /> : <Logo size={24} suffix="Control" />}
        </div>
        <nav className="flex-1 overflow-y-auto py-3 scrollbar-thin">
          {NAV.map((g) => (
            <div key={g.group} className="mb-3">
              {!collapsed && <p className="px-4 pb-1.5 text-overline uppercase text-fg-muted">{g.group}</p>}
              <ul>
                {g.items.map((it) => {
                  const n = badge(it.badge);
                  const allowed = can(it.perm);
                  return (
                    <li key={it.to}>
                      <NavLink to={it.to} end={it.end} title={collapsed ? it.label : undefined}
                        className={({ isActive }) => cx("relative mx-2 flex h-9 items-center gap-3 rounded-md px-2.5 text-body-sm transition-colors duration-fast",
                          isActive ? "bg-hover font-semibold text-fg" : "text-fg-2 hover:bg-hover hover:text-fg", !allowed && "opacity-55", collapsed && "justify-center px-0")}>
                        {({ isActive }) => (<>
                          {isActive && <span aria-hidden className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-brand" />}
                          <it.icon className="h-4 w-4 shrink-0" aria-hidden />
                          {!collapsed && <span className="flex-1 truncate">{it.label}</span>}
                          {n > 0 && <span className={cx("num rounded-full bg-review-soft px-1.5 text-[11px] font-semibold text-review", collapsed && "absolute right-1 top-0.5")} aria-label={`${n} waiting`}>{n}</span>}
                        </>)}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <button onClick={() => setCollapsed((c) => !c)} className="flex h-10 items-center justify-center gap-2 border-t border-line text-caption text-fg-2 hover:text-fg" aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}>
          <Menu className="h-4 w-4" aria-hidden />{!collapsed && "Collapse"}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar overview={counts.data} />
        <main id="console-main" className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <Routes>
            <Route index element={<Overview />} />
            <Route path="transactions" element={<Transactions />} />
            <Route path="topology" element={<Topology />} />
            <Route path="events" element={<Events />} />
            <Route path="cases" element={<Cases />} />
            <Route path="kyc" element={<Kyc />} />
            <Route path="recon" element={<Recon />} />
            <Route path="ai" element={<AiOps />} />
            <Route path="rail-lab" element={<RailLab />} />
            <Route path="audit" element={<Audit />} />
            <Route path="*" element={<Navigate to="/control" replace />} />
          </Routes>
        </main>
      </div>
      <TxnInspector />
      <CaseInspector />
      <KycInspector />
    </div>
  );
}

function TopBar({ overview }: { overview?: any }) {
  const live = useLive();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, []);
  const rail = overview?.rail;
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
      <form role="search" className="relative w-full max-w-[420px]" onSubmit={(e) => { e.preventDefault(); if (q.trim()) nav(`/control/transactions?q=${encodeURIComponent(q.trim())}`); }}>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" aria-hidden />
        <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions by reference, E2E id or correlation id"
          placeholder="Search reference, E2E or correlation id…" className="h-9 w-full rounded-md border border-line-control bg-canvas pl-9 pr-10 text-body-sm text-fg outline-none placeholder:text-fg-muted focus:border-focus" />
        <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-line-strong px-1.5 font-mono text-[11px] text-fg-muted">/</kbd>
      </form>
      <div className="ml-auto flex items-center gap-2">
        <span className={cx("hidden items-center gap-1.5 rounded-md border px-2 py-1 text-caption font-semibold lg:inline-flex",
          live.connected ? "border-success-line text-success" : "border-warning-line text-warning")} role="status" aria-live="polite">
          <Radio className={cx("h-3.5 w-3.5", live.connected && "animate-pulse-dot")} aria-hidden />
          {live.connected ? "Live" : live.reconnecting ? "Reconnecting…" : "Offline"}
        </span>
        {rail && (
          <span className="hidden items-center gap-1.5 rounded-md border border-line px-2 py-1 text-caption text-fg-2 xl:inline-flex" title="The Raast rail is a local simulator, not real infrastructure">
            <Dot tone={rail.mode === "NORMAL" && rail.breaker === "CLOSED" ? "success" : "danger"} />
            Raast rail <Badge tone="info" className="ml-0.5">Simulated</Badge>
            <span className="ref text-[11.5px]">{rail.mode}{rail.breaker !== "CLOSED" ? ` · breaker ${rail.breaker}` : ""}</span>
          </span>
        )}
        {overview && (
          <span className="hidden items-center gap-1.5 rounded-md border border-line px-2 py-1 text-caption text-fg-2 xl:inline-flex">
            <Dot tone={overview.integrity.overall === "PASS" ? "success" : overview.integrity.overall === "WARN" ? "warning" : "danger"} />
            Integrity {overview.integrity.overall.toLowerCase()}
          </span>
        )}
        <OperatorMenu />
      </div>
    </header>
  );
}

function OperatorMenu() {
  const { op, switchTo, signOut } = useOperator();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}
        className="flex h-9 items-center gap-2 rounded-md border border-line bg-raised pl-1.5 pr-2 text-body-sm hover:bg-hover">
        <span aria-hidden className="grid h-6 w-6 place-items-center rounded-full bg-brand-soft text-[12px] font-bold text-brand-accent">{op.username[0].toUpperCase()}</span>
        <span className="hidden text-left leading-tight md:block"><span className="block text-label text-fg">{op.display_name.split(" · ")[0]}</span><span className="block text-[11px] text-fg-muted">{op.role}</span></span>
        {busy ? <Spinner /> : <ChevronDown className="h-4 w-4 text-fg-muted" aria-hidden />}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-30 w-72 rounded-lg border border-line bg-raised p-1.5 shadow-e3">
          <p className="px-2.5 pb-1.5 pt-1 text-overline uppercase text-fg-muted"><UserRoundCog className="mr-1 inline h-3.5 w-3.5" aria-hidden />Act as</p>
          {STAFF.map((s) => (
            <button key={s.username} role="menuitemradio" aria-checked={s.username === op.username} disabled={busy}
              onClick={async () => { setBusy(true); setOpen(false); try { await switchTo(s.username); } finally { setBusy(false); } }}
              className={cx("flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-body-sm hover:bg-hover", s.username === op.username && "bg-hover")}>
              <Users className="h-3.5 w-3.5 text-fg-muted" aria-hidden /><span className="flex-1 text-fg">{s.name}</span><span className="text-caption text-fg-muted">{s.role}</span>
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <Button variant="ghost" size="sm" block icon={<LogOut className="h-4 w-4" />} onClick={signOut}>Sign out</Button>
        </div>
      )}
    </div>
  );
}
