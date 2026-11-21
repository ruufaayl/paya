// Audit & access: the hash-chained audit log (who did what, allowed or denied) and the role permission matrix.
import { Check, Link2, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { type Column, DataTable } from "../../ds/table";
import { Alert, Badge, Card, Input, Select, Tabs } from "../../ds/ui";
import { fmtDateTime, useApi } from "../../lib/hooks";
import { Page, Restricted, useCan, useOperator } from "../core";

export default function Audit() { return <Restricted perm={["audit:read", "access:read"]}><Inner /></Restricted>; }

function Inner() {
  const can = useCan();
  const [tab, setTab] = useState<"log" | "access">(can("audit:read") ? "log" : "access");
  return (
    <Page title="Audit & access" description="Every consequential action, allowed or denied, in a tamper-evident hash chain; and exactly which role may do what.">
      <Tabs label="Audit sections" value={tab} onChange={setTab} tabs={[{ id: "log", label: "Audit log" }, { id: "access", label: "Roles & permissions" }]} />
      <div className="mt-4">{tab === "log" ? <Restricted perm="audit:read"><Log /></Restricted> : <Restricted perm="access:read"><Access /></Restricted>}</div>
    </Page>
  );
}

function Log() {
  const { op } = useOperator();
  const [f, setF] = useState({ actor: "", action: "", outcome: "" });
  const qs = new URLSearchParams({ limit: "200", ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) });
  const log = useApi<any>(op.username, `/v1/audit/log?${qs}`, { refetchInterval: 6000 });
  const columns: Column<any>[] = [
    { key: "id", header: "#", cell: (a) => <span className="num text-fg-muted">{a.id}</span>, width: "60px" },
    { key: "at", header: "When", cell: (a) => <span className="num text-fg-2">{fmtDateTime(a.at)}</span>, width: "130px" },
    { key: "outcome", header: "Outcome", cell: (a) => <Badge tone={a.outcome === "ALLOWED" ? "neutral" : "danger"}>{a.outcome === "DENIED" && <ShieldAlert className="h-3 w-3" aria-hidden />}{a.outcome}</Badge>, width: "110px" },
    { key: "actor", header: "Actor", cell: (a) => <span><span className="text-fg">{a.actor}</span> <span className="text-caption text-fg-muted">{a.role}</span></span> },
    { key: "action", header: "Action", cell: (a) => <span className="ref text-[12.5px] text-fg">{a.action}</span> },
    { key: "obj", header: "Object", cell: (a) => <span className="ref text-[12px] text-fg-2">{a.object_type}{a.object_id ? `:${a.object_id}` : ""}</span> },
    { key: "reason", header: "Reason", cell: (a) => <span className="line-clamp-1 text-fg-2">{a.reason || "—"}</span> },
    { key: "hash", header: "Row hash", cell: (a) => <span className="ref text-[11px] text-fg-muted" title={`prev ${a.prev_hash}`}>{a.row_hash.slice(0, 12)}…</span>, width: "120px" },
  ];
  return (
    <>
      {log.data && (log.data.chain_intact
        ? <Alert tone="success" icon={<Link2 className="h-4 w-4" />} title="Hash chain intact">Every row's hash includes the previous row's hash; editing or deleting any row breaks the chain from that point.</Alert>
        : <Alert tone="danger" title="Hash chain broken">First broken row: {log.data.first_broken_row}</Alert>)}
      <Card className="mt-3 flex flex-wrap items-end gap-2 p-3">
        <Input size2="md" label="Actor" value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })} className="w-48" />
        <Input size2="md" label="Action" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} placeholder="e.g. REVERSAL, KYC" className="w-56" />
        <Select label="Outcome" value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })} className="w-40"><option value="">Any</option><option value="ALLOWED">Allowed</option><option value="DENIED">Denied</option><option value="ERROR">Error</option></Select>
      </Card>
      <div className="mt-3"><DataTable caption="Audit log" rows={log.data?.items || []} columns={columns} rowKey={(a) => String(a.id)} loading={log.isLoading} empty="No audit rows match." /></div>
    </>
  );
}

function Access() {
  const { op } = useOperator();
  const acc = useApi<any>(op.username, "/v1/admin/access");
  const d = acc.data;
  if (!d) return <Card className="p-6 text-body-sm text-fg-2">Loading…</Card>;
  const roles: string[] = d.roles;
  return (
    <div className="grid gap-4 2xl:grid-cols-[1fr_360px]">
      <div className="overflow-x-auto rounded-lg border border-line bg-surface scrollbar-thin">
        <table className="w-full min-w-[860px] text-body-sm">
          <caption className="sr-only">Permission matrix: which role holds which permission</caption>
          <thead className="bg-sunken"><tr><th scope="col" className="border-b border-line px-3 py-2 text-left text-overline uppercase text-fg-muted">Permission</th>
            {roles.map((r) => <th key={r} scope="col" className="border-b border-line px-2 py-2 text-center text-overline uppercase text-fg-muted">{r.replace("_", " ")}</th>)}</tr></thead>
          <tbody>
            {Object.entries(d.permissions as Record<string, string[]>).map(([perm, rs]) => (
              <tr key={perm} className="border-b border-line">
                <th scope="row" className="ref px-3 py-1.5 text-left text-[12.5px] font-normal text-fg">{perm}</th>
                {roles.map((r) => <td key={r} className="px-2 py-1.5 text-center">{rs.includes(r) ? <Check className="mx-auto h-4 w-4 text-success" aria-label="allowed" /> : <span className="text-fg-muted" aria-label="not allowed">·</span>}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Card className="h-fit p-4">
        <h3 className="text-title-3 text-fg">People ({d.users.length})</h3>
        <ul className="mt-2 divide-y divide-line">
          {d.users.map((u: any) => <li key={u.username} className="flex items-center justify-between gap-2 py-1.5 text-body-sm"><span className="text-fg">{u.display_name}</span><Badge tone="neutral">{u.role}</Badge></li>)}
        </ul>
        <p className="mt-3 text-caption text-fg-muted">No role holds every sensitive permission. Maker ≠ checker is enforced in the application and the database.</p>
      </Card>
    </div>
  );
}
