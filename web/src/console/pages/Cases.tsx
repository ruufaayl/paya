// Cases & approvals: the human work queue. Who owns it, who is working it, how long is left, and the
// maker-checker approvals that need a second person.
import { Check, ShieldAlert } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { CASE_STATUS } from "../../ds/status";
import { type Column, DataTable } from "../../ds/table";
import { Alert, Badge, Button, Card, Money, Ref, Select, StatusBadge, Tabs } from "../../ds/ui";
import { call } from "../../lib/api";
import { ago, fmtDateTime, useAction, useApi } from "../../lib/hooks";
import { Page, Restricted, useCan, useInspector, useOperator } from "../core";

const KINDS = ["COMPLIANCE_HOLD", "PENDING_REVIEW", "RECON_BREAK", "KYC_REVIEW"];

export default function Cases() { return <Restricted perm="cases:read"><Inner /></Restricted>; }

function Inner() {
  const { op } = useOperator();
  const can = useCan();
  const ins = useInspector();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") || "queue") as "queue" | "approvals";
  const state = params.get("state") || "OPEN";
  const kind = params.get("kind") || "";
  const scope = params.get("scope") || "all";
  const set = (k: string, v: string) => setParams((p) => { v ? p.set(k, v) : p.delete(k); return p; });
  const cases = useApi<any[]>(op.username, `/v1/cases?state=${state === "ACTIVE" ? "ALL" : state}`, { refetchInterval: 4000 });
  const approvals = useApi<any[]>(op.username, can("backoffice:read") ? "/v1/finance/approvals" : null, { refetchInterval: 4000 });
  const approve = useAction((id: string) => call(op.username, `/v1/finance/approvals/${id}/approve`, { method: "POST" }), { success: () => "Reversal approved; compensating entry posted" });

  let rows = (cases.data || []).filter((c) => !kind || c.kind === kind);
  if (state === "ACTIVE") rows = rows.filter((c) => c.state !== "RESOLVED");
  if (scope === "mine") rows = rows.filter((c) => c.owner_role === op.role);
  if (params.get("overdue")) rows = rows.filter((c) => c.overdue);
  const waiting = (approvals.data || []).filter((a) => a.status === "REQUESTED");

  const columns: Column<any>[] = [
    { key: "ref", header: "Case", cell: (c) => <Ref className="text-fg">{c.case_ref}</Ref>, width: "170px" },
    { key: "kind", header: "Type", cell: (c) => <Badge tone={c.kind === "RECON_BREAK" ? "danger" : c.kind === "PENDING_REVIEW" ? "warning" : "review"}>{c.kind.replace(/_/g, " ").toLowerCase()}</Badge>, width: "150px" },
    { key: "summary", header: "Summary", cell: (c) => <span className="line-clamp-2 text-fg">{c.summary}</span> },
    { key: "owner", header: "Owner", cell: (c) => <span className="text-fg-2">{c.owner_role}</span>, width: "110px" },
    { key: "ai", header: "AI", cell: (c) => c.ai ? <Badge tone={c.ai.abstained ? "warning" : "review"}>{c.ai.abstained ? "abstained" : "suggested"}</Badge> : <span className="text-fg-muted">—</span>, width: "100px" },
    { key: "sla", header: "SLA", cell: (c) => c.state === "RESOLVED" ? <span className="text-fg-muted">—</span> : <span className={c.overdue ? "font-semibold text-danger" : "text-fg-2"}>{c.overdue ? "overdue" : `due ${fmtDateTime(c.sla_due_at)}`}</span>, width: "140px" },
    { key: "state", header: "State", cell: (c) => <StatusBadge meta={CASE_STATUS[c.state] || CASE_STATUS.OPEN} size="sm" />, width: "120px" },
  ];

  return (
    <Page title="Cases & approvals" description="Every exception has an owner and an SLA. Decisions are made by people in the owning role and recorded in the audit chain.">
      <Tabs label="Work type" value={tab} onChange={(v) => set("tab", v === "queue" ? "" : v)}
        tabs={[{ id: "queue", label: "Case queue", count: (cases.data || []).filter((c) => c.state !== "RESOLVED").length }, { id: "approvals", label: "Approvals (maker-checker)", count: waiting.length }]} />
      {tab === "queue" ? (
        <>
          <Card className="mt-3 flex flex-wrap items-end gap-2 p-3">
            <Select label="State" hideLabel value={state} onChange={(e) => set("state", e.target.value)} className="w-40">
              <option value="OPEN">Open</option><option value="IN_REVIEW">In review</option><option value="ACTIVE">Open + in review</option><option value="RESOLVED">Resolved</option><option value="ALL">All</option>
            </Select>
            <Select label="Type" hideLabel value={kind} onChange={(e) => set("kind", e.target.value)} className="w-48">
              <option value="">All types</option>{KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ").toLowerCase()}</option>)}
            </Select>
            <Select label="Scope" hideLabel value={scope} onChange={(e) => set("scope", e.target.value)} className="w-48">
              <option value="all">All owners</option><option value="mine">Owned by my role ({op.role})</option>
            </Select>
            {params.get("overdue") && <Button size="sm" variant="ghost" onClick={() => set("overdue", "")}>Showing overdue only · clear</Button>}
          </Card>
          <div className="mt-3">
            <DataTable caption="Cases" rows={rows} columns={columns} rowKey={(c) => c.case_ref} loading={cases.isLoading} onRowClick={(c) => ins.openCase(c.case_ref)} selectedKey={ins.case}
              empty={state === "OPEN" ? "No open cases. Machines are handling everything they're allowed to." : "No cases match."} />
          </div>
        </>
      ) : (
        <div className="mt-3 space-y-3">
          <Alert tone="info" title="Maker-checker">Ops requests a reversal (maker); a different person in Finance approves it (checker). The database refuses a checker who is also the maker, and a refused attempt is audited.</Alert>
          {waiting.length === 0 && <Card className="p-6 text-center text-body-sm text-fg-2">No approvals waiting.</Card>}
          {waiting.map((a) => (
            <Card key={a.id} className="flex flex-wrap items-center gap-4 p-4">
              <ShieldAlert className="h-5 w-5 text-review" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-body font-semibold text-fg">{a.action.toLowerCase()} of <button className="ref text-brand-accent hover:underline" onClick={() => ins.openTxn(a.txn_ref)}>{a.txn_ref}</button> · <Money minor={a.amount.minor} /></p>
                <p className="text-body-sm text-fg-2">Maker <b className="text-fg">{a.maker}</b> · "{a.reason}" · {ago(a.created_at)}</p>
              </div>
              {can("reversal:approve") ? (
                <Button icon={<Check className="h-4 w-4" />} loading={approve.isPending} onClick={() => approve.mutate(a.id)}>{a.maker === op.username ? "Approve (you are the maker)" : `Approve as ${op.username}`}</Button>
              ) : <span className="text-caption text-fg-muted">Needs Finance (reversal:approve)</span>}
            </Card>
          ))}
          {(approvals.data || []).filter((a) => a.status !== "REQUESTED").slice(0, 10).map((a) => (
            <p key={a.id} className="text-body-sm text-fg-2"><Badge tone="success">{a.status.toLowerCase()}</Badge> <Ref>{a.txn_ref}</Ref> · maker {a.maker} → checker {a.checker}</p>
          ))}
        </div>
      )}
    </Page>
  );
}
