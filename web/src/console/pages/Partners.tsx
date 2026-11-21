// Super app (Theme 4) for the bank: the partner registry as third-party risk. Compliance can pause a partner;
// every change needs a reason and is written to the audit chain.
import { Pause, Play, Store } from "lucide-react";
import { useState } from "react";
import { Dialog } from "../../ds/overlay";
import { type Column, DataTable } from "../../ds/table";
import { Badge, Button, Card, Input, Metric, SectionHeader, pkr } from "../../ds/ui";
import { call } from "../../lib/api";
import { useAction, useApi } from "../../lib/hooks";
import { Page, Restricted, useCan, useOperator } from "../core";

interface Row { code: string; name: string; kind: string; status: "ACTIVE" | "SUSPENDED"; status_reason: string | null; status_by: string | null;
  scopes: string[]; active_consents: number; orders: number; completed: number; completed_minor: number; in_progress: number }

export default function Partners() { return <Restricted perm="backoffice:read"><Inner /></Restricted>; }

function Inner() {
  const { op } = useOperator();
  const can = useCan();
  const q = useApi<Row[]>(op.username, "/v1/ops/partners", { refetchInterval: 6000 });
  const [target, setTarget] = useState<Row | null>(null);
  const rows = q.data || [];
  const cols: Column<Row>[] = [
    { key: "n", header: "Partner", cell: (r) => <span><span className="block text-fg">{r.name}</span><span className="ref text-[11px] text-fg-muted">{r.code}</span></span> },
    { key: "k", header: "Type", cell: (r) => <span className="text-fg-2">{r.kind.toLowerCase()}</span>, width: "90px" },
    { key: "s", header: "Status", cell: (r) => r.status === "ACTIVE" ? <Badge tone="neutral">active</Badge>
      : <span><Badge tone="warning">suspended</Badge><span className="mt-0.5 block max-w-[220px] truncate text-caption text-fg-2" title={r.status_reason || ""}>{r.status_by}: {r.status_reason}</span></span> },
    { key: "d", header: "Data it may receive", cell: (r) => <span className="text-fg-2">{r.scopes.length ? r.scopes.join(", ") : "none"}</span> },
    { key: "c", header: "Consents", align: "right", cell: (r) => <span className="num">{r.scopes.length ? r.active_consents : "—"}</span>, width: "90px" },
    { key: "o", header: "Orders done / all", align: "right", cell: (r) => <span className="num">{r.completed} / {r.orders}</span>, width: "130px" },
    { key: "v", header: "Settled value", align: "right", cell: (r) => <span className="num">{pkr(r.completed_minor)}</span>, width: "130px" },
    { key: "a", header: "", align: "right", width: "120px", cell: (r) => can("partners:manage")
      ? <Button size="sm" variant={r.status === "ACTIVE" ? "secondary" : "primary"} icon={r.status === "ACTIVE" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          onClick={(e) => { e.stopPropagation(); setTarget(r); }}>{r.status === "ACTIVE" ? "Suspend" : "Resume"}</Button>
      : <span className="text-caption text-fg-muted">Compliance only</span> },
  ];
  return (
    <Page title="Partners & services" description="The super app's third-party services. Every order is paid as a normal Raast payment to the partner's merchant record; an order counts as done only when that payment has settled.">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Partners" value={rows.length || "—"} icon={<Store className="h-3.5 w-3.5" />} sub={`${rows.filter((r) => r.status === "SUSPENDED").length} suspended`} loading={!q.data} />
        <Metric label="Orders done" value={rows.reduce((a, r) => a + r.completed, 0)} sub={`${rows.reduce((a, r) => a + r.in_progress, 0)} waiting or processing`} loading={!q.data} />
        <Metric label="Settled through partners" value={pkr(rows.reduce((a, r) => a + r.completed_minor, 0))} loading={!q.data} />
        <Metric label="Live data-sharing consents" value={rows.reduce((a, r) => a + r.active_consents, 0)} sub="customers can withdraw any time" loading={!q.data} />
      </div>
      <div className="mt-4"><DataTable caption="Partners" rows={rows} columns={cols} rowKey={(r) => r.code} loading={q.isLoading} /></div>
      <Card className="mt-4 p-4">
        <SectionHeader level={3} title="Controls" />
        <ul className="mt-2 grid gap-2 text-body-sm text-fg-2 lg:grid-cols-2">
          <li>Prices, bills and offers come from Paya's catalogue; the client only sends item codes and quantities.</li>
          <li>One bill is paid once: a second order for the same consumer number and month is refused while one is live or done.</li>
          <li>A partner receives only the fields a customer consented to; what was shared is stored on the order. Integrity check: <span className="ref text-[11.5px]">partner_data_shared_only_with_consent</span>.</li>
          <li>Suspending a partner hides it and refuses new orders; payments already made settle normally. Investments are not offered.</li>
        </ul>
      </Card>
      {target && <StatusDialog row={target} as={op.username} onClose={() => setTarget(null)} />}
    </Page>
  );
}

function StatusDialog({ row, as, onClose }: { row: Row; as: string; onClose: () => void }) {
  const next = row.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
  const [reason, setReason] = useState("");
  const act = useAction(async () => (await call(as, `/v1/ops/partners/${row.code}/status`, { method: "POST", body: JSON.stringify({ status: next, reason }) })).data,
    { success: () => `${row.name} ${next === "SUSPENDED" ? "suspended" : "resumed"}`, onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={`${next === "SUSPENDED" ? "Suspend" : "Resume"} ${row.name}?`}
      description={next === "SUSPENDED" ? "Customers stop seeing it and can't place new orders. Payments already made are not affected." : "Customers can use it again."}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant={next === "SUSPENDED" ? "danger" : "primary"} loading={act.isPending} disabled={reason.trim().length < 5} onClick={() => act.mutate()}>{next === "SUSPENDED" ? "Suspend" : "Resume"}</Button></>}>
      <Input label="Reason (goes into the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
    </Dialog>
  );
}
