// Identity & KYC: onboarding applications, their automated checks, and the compliance decisions on referrals.
import { ScanFace } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { KYC_STATUS } from "../../ds/status";
import { type Column, DataTable } from "../../ds/table";
import { Alert, Badge, Card, Metric, Ref, StatusBadge, Tabs } from "../../ds/ui";
import { fmtDateTime, useApi } from "../../lib/hooks";
import { Page, Restricted, useInspector, useOperator } from "../core";

type F = "" | "REFERRED" | "APPROVED" | "REJECTED" | "MORE_INFO";

export default function Kyc() { return <Restricted perm="kyc:read"><Inner /></Restricted>; }

function Inner() {
  const { op } = useOperator();
  const ins = useInspector();
  const [params, setParams] = useSearchParams();
  const state = (params.get("state") || "") as F;
  const all = useApi<any[]>(op.username, "/v1/kyc/applications", { refetchInterval: 5000 });
  const engine = useApi<any>(op.username, "/v1/kyc/engine");
  const rows = (all.data || []).filter((a) => !state || a.state === state);
  const n = (s: string) => (all.data || []).filter((a) => a.state === s).length;
  const auto = (all.data || []).filter((a) => a.decision === "AUTO_APPROVED").length;
  const decided = (all.data || []).filter((a) => ["APPROVED", "REJECTED"].includes(a.state)).length;

  const columns: Column<any>[] = [
    { key: "ref", header: "Application", cell: (a) => <Ref className="text-fg">{a.ref}</Ref>, width: "190px" },
    { key: "state", header: "State", cell: (a) => <StatusBadge meta={KYC_STATUS[a.state] || KYC_STATUS.STARTED} size="sm" />, width: "150px" },
    { key: "name", header: "Applicant (synthetic)", cell: (a) => a.full_name },
    { key: "reasons", header: "Referral reasons", cell: (a) => <span className="flex flex-wrap gap-1">{(a.reasons || []).slice(0, 3).map((r: string) => <Badge key={r} tone="review">{r.replace(/_/g, " ").toLowerCase()}</Badge>)}</span> },
    { key: "two", header: "Rule", cell: (a) => a.two_person_rule ? <Badge tone="review">two-person</Badge> : <span className="text-fg-muted">—</span>, width: "110px" },
    { key: "decided", header: "Decided by", cell: (a) => a.decided_by ? <span className="text-fg-2">{a.decided_by.startsWith("system") ? "system (all checks passed)" : a.decided_by}</span> : a.recommended_by ? <span className="text-review">recommended by {a.recommended_by}</span> : <span className="text-fg-muted">—</span> },
    { key: "at", header: "Applied", cell: (a) => <span className="num text-fg-2">{fmtDateTime(a.created_at)}</span>, width: "130px" },
  ];
  return (
    <Page title="Identity & KYC" description="Machines may approve clear cases; only people reject. Referrals land here with every check's score and reason. No images are ever stored.">
      {engine.data && !engine.data.face_engine && <div className="mb-4"><Alert tone="warning" title="Face models not installed">{engine.data.note}</Alert></div>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Referred, waiting" value={n("REFERRED")} tone={n("REFERRED") ? "review" : undefined} loading={!all.data} />
        <Metric label="Auto-approved" value={auto} sub="every check passed" loading={!all.data} />
        <Metric label="Decided by people" value={decided - auto} loading={!all.data} />
        <Metric label="Face engine" value={engine.data ? (engine.data.face_engine ? "loaded" : "missing") : "—"} icon={<ScanFace className="h-3.5 w-3.5" />} sub={engine.data ? `registry ${engine.data.registry_mode.toLowerCase()} · ${engine.data.rules_version}` : undefined} />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs label="Filter applications" value={state} onChange={(v) => setParams((p) => { v ? p.set("state", v) : p.delete("state"); return p; })}
          tabs={[{ id: "", label: "All", count: all.data?.length }, { id: "REFERRED", label: "Referred", count: n("REFERRED") }, { id: "APPROVED", label: "Approved", count: n("APPROVED") },
            { id: "REJECTED", label: "Rejected", count: n("REJECTED") }, { id: "MORE_INFO", label: "More info", count: n("MORE_INFO") }]} />
      </div>
      <div className="mt-3">
        <DataTable caption="Onboarding applications" rows={rows} columns={columns} rowKey={(a) => a.ref} loading={all.isLoading} onRowClick={(a) => ins.openApp(a.ref)} selectedKey={ins.app}
          empty="No applications yet. Open a wallet from the phone app." />
      </div>
      <Card className="mt-4 p-4 text-body-sm text-fg-2">
        <b className="text-fg">Controls:</b> registry timeouts and missing models cause a referral, never a decision · a possible watch-list match needs two different officers (service check and database constraint) · applicants are never told a referral was for screening (no tipping off) · AI never sees KYC cases.
      </Card>
    </Page>
  );
}
