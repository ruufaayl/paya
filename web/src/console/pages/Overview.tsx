// Overview: the state of the money, the rail and the human work, in one screen. Every figure is computed by
// the backend from systems of record (GET /v1/ops/overview, /v1/ops/timeseries).
import { AlertTriangle, ArrowRight, Clock3, Hand, Landmark, Radio, Scale, Timer } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { LineChart, StackedBars } from "../../ds/charts";
import { CHECK_STATUS, paymentMeta } from "../../ds/status";
import { Badge, Card, Metric, SectionHeader, StatusBadge, Tabs, pkr } from "../../ds/ui";
import { ago, useApi } from "../../lib/hooks";
import { Page, Restricted, useInspector, useLive, useOperator } from "../core";

export const SERIES = [
  { key: "settled", label: "Settled", color: "#2FA36B" },
  { key: "in_flight", label: "In flight", color: "#3D7FE6" },
  { key: "failed", label: "Failed / returned", color: "#E0603A" },
  { key: "review", label: "Under review", color: "#A86BC0" },
];

export default function Overview() {
  return <Restricted perm="backoffice:read"><Inner /></Restricted>;
}

function Inner() {
  const { op } = useOperator();
  const [win, setWin] = useState<"15" | "60" | "1440">("60");
  const ov = useApi<any>(op.username, "/v1/ops/overview", { refetchInterval: 4000 });
  const ts = useApi<any>(op.username, `/v1/ops/timeseries?window_minutes=${win}&buckets=${win === "15" ? 15 : 30}`, { refetchInterval: 5000 });
  const o = ov.data;
  const hw = o?.human_work;
  const openCases = hw ? Object.values(hw.open_cases || {}).reduce((a: number, b: any) => a + b, 0) as number : 0;
  const label = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const series = (ts.data?.series || []).map((b: any) => ({ ...b, label: label(b.start) }));

  return (
    <Page title="Overview" description="Live state of payments, the simulated Raast rail, ledger integrity and the human work queue."
      actions={<span className="text-caption text-fg-muted">Updated {o ? ago(o.generated_at) : "—"}</span>}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-8">
        <Metric label="Success rate" loading={!o} icon={<Scale className="h-3.5 w-3.5" />}
          value={o?.payments.success_rate == null ? "—" : `${(o.payments.success_rate * 100).toFixed(1)}%`} sub={o ? `${o.payments.settled} settled of ${o.payments.total}` : undefined} />
        <Metric label="In flight" loading={!o} icon={<Clock3 className="h-3.5 w-3.5" />} value={o?.payments.in_flight ?? "—"} tone={o?.payments.in_flight ? "processing" : undefined} sub="not yet final" />
        <Metric label="Awaiting rail ack" loading={!o} icon={<Radio className="h-3.5 w-3.5" />} value={o?.payments.awaiting_rail_ack ?? "—"} tone={o?.payments.awaiting_rail_ack ? "warning" : undefined} sub="PENDING at Raast" />
        <Metric label="Value in transit" loading={!o} icon={<Landmark className="h-3.5 w-3.5" />} value={o ? pkr(o.value_in_transit.minor) : "—"} sub="ledger account 2150" />
        <Metric label="Need a human" loading={!o} icon={<Hand className="h-3.5 w-3.5" />} value={o ? openCases + hw.approvals_waiting : "—"} tone={openCases ? "review" : undefined} sub={hw ? `${hw.overdue} overdue · ${hw.unassigned} unassigned` : undefined} />
        <Metric label="Settle time p95" loading={!ts.data} icon={<Timer className="h-3.5 w-3.5" />} value={ts.data?.totals.settle_p95_s != null ? `${ts.data.totals.settle_p95_s}s` : "—"} sub={ts.data?.totals.settle_p50_s != null ? `p50 ${ts.data.totals.settle_p50_s}s` : "no settlements in window"} />
        <Metric label="Recon match" loading={!o} icon={<Scale className="h-3.5 w-3.5" />} value={o?.recon?.match_rate != null ? `${(o.recon.match_rate * 100).toFixed(0)}%` : "—"} tone={o?.recon?.breaks ? "danger" : undefined} sub={o?.recon ? `${o.recon.breaks} breaks · ${ago(o.recon.at)}` : "no run yet"} />
        <Metric label="Ledger integrity" loading={!o} icon={<Scale className="h-3.5 w-3.5" />} value={o ? o.integrity.overall : "—"} tone={o ? (o.integrity.overall === "PASS" ? "success" : o.integrity.overall === "WARN" ? "warning" : "danger") : undefined} sub={o ? `${o.integrity.checked} checks` : undefined} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="p-4 xl:col-span-2">
          <SectionHeader level={3} title="Payments by outcome" description="Payments created in each interval, coloured by their current status."
            actions={<Tabs label="Time window" value={win} onChange={setWin} tabs={[{ id: "15", label: "15 min" }, { id: "60", label: "1 hour" }, { id: "1440", label: "24 h" }]} />} />
          <div className="mt-3"><StackedBars title="Payments by outcome over time" data={series} series={SERIES} height={200} /></div>
          <div className="mt-4 border-t border-line pt-3">
            <p className="text-label text-fg-2">Median time to settle (seconds)</p>
            <LineChart title="Median seconds from request to Raast settlement" points={series.map((b: any) => ({ label: b.label, value: b.settle_p50_s }))} format={(n) => `${n.toFixed(1)}s`} height={110} />
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <SectionHeader level={3} title="Needs attention" />
            <ul className="mt-3 space-y-2">
              {o?.integrity.failing.map((c: any) => (
                <li key={c.check} className="flex items-start gap-2 text-body-sm"><StatusBadge meta={CHECK_STATUS[c.status]} size="sm" /><span className="text-fg">{c.check.replace(/_/g, " ")}<span className="block text-caption text-fg-2">{c.detail}</span></span></li>
              ))}
              {hw?.overdue > 0 && <li><Link to="/control/cases?overdue=1" className="flex items-center gap-2 text-body-sm text-danger hover:underline"><AlertTriangle className="h-4 w-4" />{hw.overdue} case(s) past their SLA</Link></li>}
              {hw?.approvals_waiting > 0 && <li><Link to="/control/cases?tab=approvals" className="flex items-center gap-2 text-body-sm text-review hover:underline"><Hand className="h-4 w-4" />{hw.approvals_waiting} reversal(s) waiting for a checker</Link></li>}
              {hw?.kyc_referred > 0 && <li><Link to="/control/kyc?state=REFERRED" className="flex items-center gap-2 text-body-sm text-review hover:underline"><Hand className="h-4 w-4" />{hw.kyc_referred} onboarding application(s) referred</Link></li>}
              {o && o.integrity.failing.length === 0 && !hw.overdue && !hw.approvals_waiting && !hw.kyc_referred && <li className="text-body-sm text-fg-2">Nothing needs attention. All {o.integrity.checked} integrity checks pass.</li>}
            </ul>
          </Card>
          <Card className="p-4">
            <SectionHeader level={3} title="Dependencies" description="Simulators, clearly separated from real infrastructure." />
            {o && <dl className="mt-3 space-y-2 text-body-sm">
              <div className="flex items-center justify-between"><dt className="text-fg-2">Raast rail <Badge tone="info">simulated</Badge></dt><dd className="ref text-fg">{o.rail.mode} · breaker {o.rail.breaker}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-fg-2">Identity registry <Badge tone="info">simulated</Badge></dt><dd className="ref text-fg">{o.registry.mode}</dd></div>
            </dl>}
            <Link to="/control/rail-lab" className="mt-3 inline-flex items-center gap-1 text-label text-brand-accent hover:underline">Open the rail lab <ArrowRight className="h-3.5 w-3.5" /></Link>
          </Card>
          <RecentActivity />
        </div>
      </div>

      {o && (
        <Card className="mt-4 p-4">
          <SectionHeader level={3} title="Payments by status" description="All payments in the database." />
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(o.payments.by_status).sort((a: any, b: any) => b[1] - a[1]).map(([s, n]) => (
              <Link key={s} to={`/control/transactions?status=${s}`} className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 hover:bg-hover">
                <StatusBadge meta={paymentMeta(s)} size="sm" label={s} /><span className="num text-body-sm font-semibold text-fg">{n as number}</span>
              </Link>
            ))}
            {Object.keys(o.payments.by_status).length === 0 && <p className="text-body-sm text-fg-2">No payments yet. Make one from the wallet or the rail lab.</p>}
          </div>
        </Card>
      )}
    </Page>
  );
}

function RecentActivity() {
  const live = useLive();
  const ins = useInspector();
  const events = live.messages.filter((m) => m.kind === "event").slice(0, 7);
  return (
    <Card className="p-4">
      <SectionHeader level={3} title="Latest facts" actions={<Link to="/control/events" className="text-label text-brand-accent hover:underline">Event stream</Link>} />
      <ul className="mt-2 divide-y divide-line">
        {events.length === 0 && <li className="py-3 text-body-sm text-fg-2">Waiting for events from the outbox…</li>}
        {events.map((m) => (
          <li key={m._id} className="flex items-center gap-2 py-2 text-body-sm">
            <span className="ref w-36 shrink-0 truncate text-[12px] text-fg">{m.type}</span>
            {m.payload?.txn_ref ? <button onClick={() => ins.openTxn(m.payload!.txn_ref)} className="ref truncate text-[12px] text-brand-accent hover:underline">{m.payload.txn_ref}</button> : <span className="truncate text-caption text-fg-2">{m.payload?.ref || m.payload?.case_ref || ""}</span>}
            <span className="num ml-auto shrink-0 text-caption text-fg-muted">{new Date(m.occurred_at || m._rx).toLocaleTimeString()}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
