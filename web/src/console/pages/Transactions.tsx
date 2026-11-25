// Transaction Explorer: search and investigate every payment. Filters live in the URL so a view can be shared.
import { keepPreviousData } from "@tanstack/react-query";
import { Filter, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { paymentMeta } from "../../ds/status";
import { type Column, DataTable, Pagination } from "../../ds/table";
import { Badge, Button, Card, Input, Money, Ref, SearchInput, Select, StatusBadge } from "../../ds/ui";
import { fmtDateTime, useApi } from "../../lib/hooks";
import { Page, Restricted, useInspector, useOperator } from "../core";

const STATUSES = ["CREATED", "VALIDATED", "AUTHORISED", "POSTED", "PENDING", "SETTLED", "RECONCILED", "UNDER_REVIEW", "REVERSED", "REJECTED", "FAILED", "EXPIRED", "COMPLETED"];
const FILTER_KEYS = ["q", "status", "type", "merchant", "customer", "min", "max", "from", "to", "recon", "rail", "flagged"];

export default function Transactions() { return <Restricted perm="backoffice:read"><Inner /></Restricted>; }

function Inner() {
  const { op } = useOperator();
  const ins = useInspector();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") || "");
  const page = Number(params.get("page") || "1");
  const set = (k: string, v: string) => setParams((p) => { v ? p.set(k, v) : p.delete(k); if (k !== "page") p.delete("page"); return p; });
  useEffect(() => { const t = setTimeout(() => { if ((params.get("q") || "") !== q) set("q", q); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setQ(params.get("q") || ""); }, [params.get("q")]);

  const api = new URLSearchParams();
  const g = (k: string) => params.get(k) || "";
  if (g("q")) api.set("q", g("q"));
  if (g("status")) api.set("status", g("status"));
  if (g("type")) api.set("type", g("type"));
  if (g("merchant")) api.set("merchant", g("merchant"));
  if (g("customer")) api.set("customer", g("customer"));
  if (g("min")) api.set("min_amount_minor", String(Math.round(Number(g("min")) * 100)));
  if (g("max")) api.set("max_amount_minor", String(Math.round(Number(g("max")) * 100)));
  if (g("from")) api.set("date_from", new Date(g("from")).toISOString());
  if (g("to")) api.set("date_to", new Date(g("to")).toISOString());
  if (g("recon")) api.set("recon", g("recon"));
  if (g("rail")) api.set("rail", g("rail"));
  if (g("flagged")) api.set("flagged", g("flagged"));
  api.set("page", String(page)); api.set("page_size", "25");
  const res = useApi<any>(op.username, `/v1/ops/transactions?${api}`, { placeholderData: keepPreviousData, refetchInterval: 6000 });
  const active = FILTER_KEYS.filter((k) => params.get(k)).length;

  const columns: Column<any>[] = [
    { key: "ref", header: "Reference", cell: (t) => <Ref className="whitespace-nowrap text-fg">{t.txn_ref}</Ref>, width: "190px" },
    { key: "status", header: "Status", cell: (t) => <StatusBadge meta={paymentMeta(t.status)} size="sm" label={t.status.replace(/_/g, " ")} />, width: "150px" },
    { key: "amount", header: "Amount", align: "right", cell: (t) => <Money minor={t.amount.minor} className="font-semibold" />, width: "120px" },
    { key: "merchant", header: "Merchant", cell: (t) => t.merchant || <span className="text-fg-muted">—</span> },
    { key: "customer", header: "Customer", cell: (t) => t.customer || <span className="text-fg-muted">—</span> },
    { key: "rail", header: "Rail", cell: (t) => t.rail_attempts ? <span className="text-fg-2">sent{t.rail_attempts > 1 ? ` ×${t.rail_attempts}` : ""}</span> : <span className="text-fg-muted">not sent</span> },
    { key: "recon", header: "Recon", cell: (t) => t.recon_result ? <Badge tone={t.recon_result === "MATCHED" ? "success" : "warning"}>{t.recon_result.toLowerCase().replace(/_/g, " ")}</Badge> : <span className="text-fg-muted">—</span> },
    { key: "flags", header: "Flags", cell: (t) => <span className="flex gap-1">{t.flags.map((f: string) => <Badge key={f} tone="review">{f.toLowerCase()}</Badge>)}</span> },
    { key: "created", header: "Created", cell: (t) => <span className="num whitespace-nowrap text-fg-2">{fmtDateTime(t.created_at)}</span>, width: "140px" },
  ];

  return (
    <Page title="Transactions" description="Search by immutable reference, Raast end-to-end id or correlation id. Open any row for its full ledger and decision trail.">
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <SearchInput className="min-w-[260px] flex-1" value={q} onChange={setQ} placeholder="RUPAY-…, E2E…, corr-…" label="Search transactions" />
          <Select label="Status" hideLabel value={g("status")} onChange={(e) => set("status", e.target.value)} className="w-40">
            <option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}
          </Select>
          <Select label="Type" hideLabel value={g("type")} onChange={(e) => set("type", e.target.value)} className="w-36">
            <option value="">All types</option>{["PAYMENT", "REVERSAL", "TOPUP", "REFUND"].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
          </Select>
          <Select label="Reconciliation" hideLabel value={g("recon")} onChange={(e) => set("recon", e.target.value)} className="w-44">
            <option value="">Any recon state</option><option value="RECONCILED">reconciled</option><option value="UNRECONCILED">settled, not yet reconciled</option><option value="BREAK">reconciliation break</option>
          </Select>
          <Select label="Rail" hideLabel value={g("rail")} onChange={(e) => set("rail", e.target.value)} className="w-36">
            <option value="">Any rail state</option><option value="NOT_SENT">not sent</option><option value="SENT">sent</option><option value="RETRIED">retried</option>
          </Select>
          <Select label="Risk" hideLabel value={g("flagged")} onChange={(e) => set("flagged", e.target.value)} className="w-40">
            <option value="">Any risk flag</option><option value="true">flagged (screening or case)</option><option value="false">not flagged</option>
          </Select>
        </div>
        <details className="mt-2" open={!!(g("merchant") || g("customer") || g("min") || g("max") || g("from") || g("to"))}>
          <summary className="cursor-pointer select-none text-label text-fg-2"><Filter className="mr-1 inline h-3.5 w-3.5" aria-hidden />More filters</summary>
          <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <Input size2="md" label="Merchant" value={g("merchant")} onChange={(e) => set("merchant", e.target.value)} placeholder="Chai…" />
            <Input size2="md" label="Customer" value={g("customer")} onChange={(e) => set("customer", e.target.value)} placeholder="Sara…" />
            <Input size2="md" label="Min amount (Rs)" type="number" min={0} value={g("min")} onChange={(e) => set("min", e.target.value)} />
            <Input size2="md" label="Max amount (Rs)" type="number" min={0} value={g("max")} onChange={(e) => set("max", e.target.value)} />
            <Input size2="md" label="From" type="datetime-local" value={g("from")} onChange={(e) => set("from", e.target.value)} />
            <Input size2="md" label="To" type="datetime-local" value={g("to")} onChange={(e) => set("to", e.target.value)} />
          </div>
        </details>
        {active > 0 && <Button size="sm" variant="ghost" className="mt-2" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => { setQ(""); setParams(new URLSearchParams()); }}>Clear {active} filter{active > 1 ? "s" : ""}</Button>}
      </Card>
      <div className="mt-3">
        <DataTable caption="Transactions" rows={res.data?.items || []} columns={columns} rowKey={(t) => t.txn_ref} loading={res.isLoading}
          onRowClick={(t) => ins.openTxn(t.txn_ref)} selectedKey={ins.txn} empty="No transactions match these filters." />
      </div>
      {res.data && <div className="mt-3"><Pagination page={page} pageSize={25} total={res.data.total} onPage={(n) => set("page", String(n))} /></div>}
    </Page>
  );
}
