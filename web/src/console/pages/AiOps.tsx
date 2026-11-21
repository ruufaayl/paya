// AI operations: how the triage agent is behaving. It suggests; people decide. Abstention is a feature.
import { Bot, ShieldCheck } from "lucide-react";
import { type Column, DataTable } from "../../ds/table";
import { Alert, Badge, Card, Metric, Ref, SectionHeader } from "../../ds/ui";
import { useApi } from "../../lib/hooks";
import { Page, Restricted, useInspector, useOperator } from "../core";

export default function AiOps() { return <Restricted perm="backoffice:read"><Inner /></Restricted>; }

function Inner() {
  const { op } = useOperator();
  const ins = useInspector();
  const m = useApi<any>(op.username, "/v1/ai/metrics", { refetchInterval: 6000 });
  const cases = useApi<any[]>(op.username, "/v1/cases?state=ALL", { refetchInterval: 6000 });
  const rows = (cases.data || []).filter((c) => c.ai);
  const pct = (v?: number) => v == null ? "—" : `${Math.round(v * 100)}%`;
  const columns: Column<any>[] = [
    { key: "case", header: "Case", cell: (c) => <Ref className="text-fg">{c.case_ref}</Ref>, width: "170px" },
    { key: "s", header: "Suggestion", cell: (c) => c.ai.abstained ? <Badge tone="warning">abstained: human decides</Badge> : <span className="text-fg">{c.ai.next_action?.replace(/_/g, " ").toLowerCase()}</span> },
    { key: "conf", header: "Confidence", align: "right", cell: (c) => <span className="num">{pct(c.ai.confidence)}</span>, width: "110px" },
    { key: "why", header: "Abstained because", cell: (c) => <span className="text-fg-2">{(c.ai.abstain_reasons || []).join(", ") || "—"}</span> },
    { key: "rev", header: "Human review", cell: (c) => c.ai.reviewer_decision ? <Badge tone={c.ai.reviewer_decision === "ACCEPTED" ? "success" : "warning"}>{c.ai.reviewer_decision.toLowerCase()} · {c.ai.reviewer}</Badge> : <span className="text-fg-muted">pending</span> },
    { key: "eng", header: "Engine", cell: (c) => <span className="ref text-[11.5px] text-fg-2">{c.ai.engine}</span> },
  ];
  return (
    <Page title="AI operations" description="The reconciliation-triage agent: rules first, optional guarded LLM, advisory only. It cannot move money and never sees identity (KYC) decisions.">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Metric label="Suggestions" value={m.data?.suggestions ?? "—"} icon={<Bot className="h-3.5 w-3.5" />} loading={!m.data} />
        <Metric label="Abstention rate" value={pct(m.data?.abstention_rate)} sub="high value, low confidence, missing evidence" loading={!m.data} />
        <Metric label="Accepted by people" value={pct(m.data?.acceptance_rate)} sub={m.data ? `${m.data.reviewed} reviewed` : undefined} loading={!m.data} />
        <Metric label="Overridden" value={pct(m.data?.override_rate)} loading={!m.data} />
        <Metric label="Latency p95" value={m.data?.latency_p95_ms != null ? `${m.data.latency_p95_ms} ms` : "—"} loading={!m.data} />
        <Metric label="Audit completeness" value={pct(m.data?.audit_completeness)} tone={m.data && m.data.suggestions && m.data.audit_completeness < 1 ? "danger" : undefined} loading={!m.data} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_360px]">
        <div>
          <SectionHeader level={3} title="Suggestions and their human review" />
          <div className="mt-3"><DataTable caption="AI suggestions" rows={rows} columns={columns} rowKey={(c) => c.case_ref} loading={cases.isLoading} onRowClick={(c) => ins.openCase(c.case_ref)}
            empty="No suggestions yet. Ask the AI from a reconciliation break or pending-review case." /></div>
        </div>
        <Card className="h-fit p-4">
          <SectionHeader level={3} title="Guardrails" />
          <ul className="mt-2 space-y-2 text-body-sm text-fg-2">
            {["Abstains below 75% confidence, above Rs 100,000, with missing evidence, or when compliance is involved.",
              "Output must be one allow-listed action and cite evidence that exists; otherwise the rules engine answers.",
              "Rail free text is treated as quoted data (prompt-injection safe: 20/20 in evaluation).",
              "Only the case's owning role can accept or override; every suggestion is audited with a prompt hash.",
              "No code path from the agent to the ledger (source-checked test)."].map((t) => (
              <li key={t} className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />{t}</li>
            ))}
          </ul>
          <div className="mt-3"><Alert tone="info" title="Engine">{m.data?.engine || "rules (no LLM configured)"}. Offline evaluation: 94.1% accuracy, 0% unsafe autonomy on 120 labelled cases (evidence/ai).</Alert></div>
        </Card>
      </div>
    </Page>
  );
}
