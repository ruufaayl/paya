// Reconciliation & settlement: import the (simulated) Raast settlement file, see every line's category, chase
// breaks through their cases, and check the ledger's own integrity.
import { Copy, FileUp, Scale } from "lucide-react";
import { useState } from "react";
import { ShareBar } from "../../ds/charts";
import { CHECK_STATUS, RECON_CATEGORY } from "../../ds/status";
import { type Column, DataTable } from "../../ds/table";
import { Alert, Badge, Button, Card, Input, Money, Ref, SectionHeader, StatusBadge, cx, pkr } from "../../ds/ui";
import { call } from "../../lib/api";
import { fmtDateTime, useAction, useApi } from "../../lib/hooks";
import { Page, Restricted, useCan, useInspector, useOperator } from "../core";

const CAT_COLOR: Record<string, string> = { MATCHED: "#2FA36B", TIMING_DIFFERENCE: "#3D7FE6", MISSING_EXTERNAL: "#E0603A", MISSING_INTERNAL: "#E0603A", DUPLICATE_EXTERNAL: "#D9A23A", AMOUNT_MISMATCH: "#E0603A", STATUS_MISMATCH: "#D9A23A" };

export default function Recon() { return <Restricted perm="backoffice:read"><Inner /></Restricted>; }

function Inner() {
  const { op } = useOperator();
  const can = useCan();
  const ins = useInspector();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [sel, setSel] = useState<string | null>(null);
  const [cat, setCat] = useState<string>("");
  const runs = useApi<any[]>(op.username, can("finance:read") ? "/v1/finance/recon/runs" : null, { refetchInterval: 6000 });
  const runId = sel || runs.data?.[0]?.id || null;
  const items = useApi<any>(op.username, runId ? `/v1/finance/recon/runs/${runId}/items` : null);
  const tb = useApi<any>(op.username, can("finance:read") ? "/v1/finance/trial-balance" : null, { refetchInterval: 8000 });
  const integ = useApi<any>(op.username, can("finance:read") ? "/v1/finance/integrity" : null, { refetchInterval: 8000 });
  const run = useAction((dup: boolean) => call<any>(op.username, "/v1/finance/recon/run", { method: "POST", body: JSON.stringify({ business_date: date, duplicate_line: dup }) }),
    { success: (r: any) => `File ${r.data.file_id}: ${r.data.records} lines, match rate ${Math.round((r.data.match_rate || 0) * 100)}%`, onDone: (r: any) => setSel(r.data.run_id) });

  const it = items.data;
  const counts: Record<string, number> = {};
  (it?.items || []).forEach((i: any) => { counts[i.category] = (counts[i.category] || 0) + 1; });
  const shown = (it?.items || []).filter((i: any) => !cat || i.category === cat);
  const columns: Column<any>[] = [
    { key: "cat", header: "Category", cell: (i) => { const m = RECON_CATEGORY[i.category]; return <span title={m?.help}><StatusBadge meta={m} size="sm" /></span>; }, width: "190px" },
    { key: "txn", header: "Ledger transaction", cell: (i) => i.txn_ref ? <button className="ref text-[12.5px] text-brand-accent hover:underline" onClick={(e) => { e.stopPropagation(); ins.openTxn(i.txn_ref); }}>{i.txn_ref}</button> : <span className="text-fg-muted">none</span> },
    { key: "e2e", header: "Raast E2E", cell: (i) => i.rail_e2e_id ? <Ref className="text-[11.5px]">{i.rail_e2e_id}</Ref> : <span className="text-fg-muted">—</span> },
    { key: "int", header: "Ledger", align: "right", cell: (i) => i.internal ? <Money minor={i.internal.minor} /> : "—", width: "110px" },
    { key: "ext", header: "Raast file", align: "right", cell: (i) => i.external ? <Money minor={i.external.minor} /> : "—", width: "110px" },
    { key: "diff", header: "Difference", align: "right", cell: (i) => i.difference_minor && i.category !== "MATCHED" ? <Money minor={i.difference_minor} sign className="text-danger" /> : <span className="text-fg-muted">—</span>, width: "110px" },
    { key: "case", header: "Case", cell: (i) => i.case ? <button className="text-brand-accent hover:underline" onClick={(e) => { e.stopPropagation(); ins.openCase(i.case.case_ref); }}><Ref className="text-brand-accent">{i.case.case_ref}</Ref> · {i.case.state.toLowerCase()}{i.case.assigned_to ? ` · ${i.case.assigned_to}` : ""}</button> : <span className="text-fg-muted">—</span> },
  ];
  const breaksValue = (it?.items || []).filter((i: any) => !["MATCHED", "TIMING_DIFFERENCE"].includes(i.category)).reduce((a: number, i: any) => a + Math.abs(i.difference_minor || i.internal?.minor || i.external?.minor || 0), 0);

  return (
    <Page title="Reconciliation & settlement" description="Compare Paya's ledger with the Raast settlement file (simulated). Each break becomes an owned case; the same file can never be imported twice.">
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card className="p-4">
          <SectionHeader level={3} title="Import a settlement file" description="Fetches the simulated rail's file for a business date, verifies control totals and the file hash, then matches every line." />
          {!can("recon:run") && <div className="mt-3"><Alert tone="warning" title="Finance only">Running reconciliation needs recon:run (Finance). Switch operator to Rabia to run it.</Alert></div>}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Input size2="md" label="Business date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
            <Button disabled={!can("recon:run")} loading={run.isPending} icon={<FileUp className="h-4 w-4" />} onClick={() => run.mutate(false)}>Import and reconcile</Button>
            <Button variant="secondary" disabled={!can("recon:run")} icon={<Copy className="h-4 w-4" />} onClick={() => run.mutate(false)}>Import the same file again</Button>
            <Button variant="ghost" disabled={!can("recon:run")} onClick={() => run.mutate(true)}>Test: file with a duplicated line</Button>
          </div>
          <p className="mt-2 text-caption text-fg-muted">A second import of an identical file is refused by its SHA-256 (database unique constraint). That refusal is expected.</p>

          <div className="mt-5 border-t border-line pt-4">
            <SectionHeader level={3} title="Import history" />
            <ul className="mt-2 divide-y divide-line">
              {(runs.data || []).length === 0 && <li className="py-3 text-body-sm text-fg-2">No files imported yet.</li>}
              {(runs.data || []).slice(0, 8).map((r) => (
                <li key={r.id}>
                  <button onClick={() => setSel(r.id)} aria-pressed={runId === r.id} className={cx("flex w-full flex-wrap items-center gap-3 px-2 py-2 text-left text-body-sm hover:bg-hover", runId === r.id && "bg-hover")}>
                    <Ref className="text-fg">{r.file_id}</Ref><span className="text-fg-2">business date {r.business_date}</span>
                    <span className="num text-fg-2">{r.records} lines · {r.value_total.pkr}</span>
                    <Badge tone={r.summary.match_rate === 1 ? "success" : "warning"}>{Math.round((r.summary.match_rate || 0) * 100)}% matched</Badge>
                    <span className="ml-auto text-caption text-fg-muted">{r.run_by} · {fmtDateTime(r.at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <SectionHeader level={3} title="Trial balance" />
            {tb.data ? (
              <div className="mt-2 text-body-sm">
                <p className={cx("flex items-center gap-2 font-semibold", tb.data.balanced ? "text-success" : "text-danger")}><Scale className="h-4 w-4" aria-hidden />{tb.data.balanced ? "Balanced" : "NOT BALANCED"}</p>
                <p className="num mt-1 text-fg-2">Debits {pkr(tb.data.total_debit_minor)} · Credits {pkr(tb.data.total_credit_minor)}</p>
              </div>
            ) : <p className="mt-2 text-body-sm text-fg-2">Visible to Finance and Audit.</p>}
          </Card>
          <Card className="p-4">
            <SectionHeader level={3} title="Integrity checks" description={integ.data ? `Overall ${integ.data.overall} · ${integ.data.checks.length} checks across 4 layers` : undefined} />
            <ul className="mt-2 space-y-1.5">
              {(integ.data?.checks || []).map((c: any) => (
                <li key={c.check} className="flex items-start gap-2 text-body-sm"><StatusBadge meta={CHECK_STATUS[c.status]} size="sm" /><span className="min-w-0 text-fg" title={c.detail}>{c.check.replace(/_/g, " ")}<span className="block text-caption text-fg-muted">{c.layer}</span></span></li>
              ))}
              {!integ.data && <li className="text-body-sm text-fg-2">Visible to Finance and Audit.</li>}
            </ul>
          </Card>
        </div>
      </div>

      {it && (
        <Card className="mt-4 p-4">
          <SectionHeader level={3} title={<>File <span className="ref">{it.run.file_id}</span></>}
            description={<>sha256 <span className="ref">{it.run.file_sha256.slice(0, 16)}…</span> · {it.run.records} lines · run by {it.run.run_by} · finance impact of open breaks <b className="text-fg">{pkr(breaksValue)}</b></>} />
          <div className="mt-3"><ShareBar title="Lines by category" parts={Object.entries(counts).map(([k, v]) => ({ label: RECON_CATEGORY[k]?.label || k, value: v, color: CAT_COLOR[k] || "#84919E" }))} /></div>
          <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
            <button aria-pressed={!cat} onClick={() => setCat("")} className={cx("rounded-md border px-2.5 py-1 text-caption", !cat ? "border-focus text-fg" : "border-line text-fg-2")}>All {it.items.length}</button>
            {Object.entries(counts).map(([k, v]) => (
              <button key={k} aria-pressed={cat === k} onClick={() => setCat(k)} className={cx("flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-caption", cat === k ? "border-focus text-fg" : "border-line text-fg-2")}>
                <span className="h-2 w-2 rounded-sm" style={{ background: CAT_COLOR[k] }} aria-hidden />{RECON_CATEGORY[k]?.label || k} <span className="num">{v}</span>
              </button>
            ))}
          </div>
          <div className="mt-3"><DataTable caption="Reconciliation lines" rows={shown} columns={columns} rowKey={(i) => i.id} loading={items.isLoading} empty="No lines in this category." /></div>
        </Card>
      )}
    </Page>
  );
}
