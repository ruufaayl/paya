// Green banking (Theme 2) for the bank: portfolio aggregates only. No individual customer's footprint is shown.
import { Leaf, PiggyBank, Trees } from "lucide-react";
import { type Column, DataTable } from "../../ds/table";
import { Alert, Badge, Card, Metric, SectionHeader, pkr } from "../../ds/ui";
import { useApi } from "../../lib/hooks";
import { Page, Restricted, useOperator } from "../core";

interface Portfolio {
  factor_set: string;
  pots: { count: number; total_minor: number; ledger_account: string; moves_in: number; moves_out: number };
  offsets: { payments: number; total_minor: number; tonnes: number; project: string };
  footprint_30d: { total_kg: number; categories: { category: string; label: string; spent_minor: number; kg: number }[] };
}
interface Factors { factor_set: string; unit: string; uncertainty: number; status: string; factors: { category: string; label: string; kg_per_1000: number }[] }

export default function Green() { return <Restricted perm="backoffice:read"><Inner /></Restricted>; }

const kg = (n: number) => n >= 1000 ? `${(n / 1000).toLocaleString("en-PK", { maximumFractionDigits: 2 })} t` : `${n.toLocaleString("en-PK", { maximumFractionDigits: 1 })} kg`;

function Inner() {
  const { op } = useOperator();
  const p = useApi<Portfolio>(op.username, "/v1/ops/green/portfolio", { refetchInterval: 8000 });
  const f = useApi<Factors>(op.username, "/v1/green/factors");
  const max = Math.max(1, ...(p.data?.footprint_30d.categories.map((c) => c.kg) || [0]));
  const cols: Column<Factors["factors"][number]>[] = [
    { key: "c", header: "Category", cell: (r) => <span className="text-fg">{r.label}</span> },
    { key: "code", header: "Code", cell: (r) => <span className="ref text-[11.5px] text-fg-2">{r.category}</span> },
    { key: "k", header: "kg CO₂e per Rs 1,000", align: "right", cell: (r) => <span className="num">{r.kg_per_1000}</span>, width: "190px" },
  ];
  return (
    <Page title="Green banking" description="Customers' green pots (their own money on ledger account 2110), offsets paid through the normal Raast path, and a spend-based footprint estimate. Aggregates only.">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Green pots in use" value={p.data?.pots.count ?? "—"} icon={<PiggyBank className="h-3.5 w-3.5" />} sub={p.data ? `${p.data.pots.moves_in} in · ${p.data.pots.moves_out} out` : undefined} loading={!p.data} />
        <Metric label="Held in pots" value={p.data ? pkr(p.data.pots.total_minor) : "—"} sub={`ledger ${p.data?.pots.ledger_account ?? "2110"} (liability)`} loading={!p.data} />
        <Metric label="Offsets settled" value={p.data ? pkr(p.data.offsets.total_minor) : "—"} icon={<Trees className="h-3.5 w-3.5" />} sub={p.data ? `${p.data.offsets.payments} payment${p.data.offsets.payments === 1 ? "" : "s"} · about ${p.data.offsets.tonnes} t` : undefined} loading={!p.data} />
        <Metric label="Est. footprint, 30 days" value={p.data ? kg(p.data.footprint_30d.total_kg) : "—"} icon={<Leaf className="h-3.5 w-3.5" />} sub={`all settled payments · ${p.data?.factor_set ?? ""}`} loading={!p.data} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_420px]">
        <Card className="p-4">
          <SectionHeader level={3} title="Estimated footprint by merchant category" description="Settled payments in the last 30 days × the factor for each category. An estimate for portfolio insight, not a measurement." />
          <ul className="mt-3 space-y-3">
            {p.data?.footprint_30d.categories.map((c) => (
              <li key={c.category}>
                <div className="flex items-baseline justify-between text-body-sm"><span className="text-fg">{c.label}</span><span className="num text-fg">{kg(c.kg)} <span className="text-fg-muted">· {pkr(c.spent_minor)}</span></span></div>
                <div className="mt-1 h-2 rounded-full bg-sunken" aria-hidden><div className="h-2 rounded-full bg-brand" style={{ width: `${(c.kg / max) * 100}%` }} /></div>
              </li>
            ))}
            {p.data && p.data.footprint_30d.categories.length === 0 && <li className="text-body-sm text-fg-2">No settled payments in the last 30 days.</li>}
          </ul>
        </Card>
        <Card className="h-fit p-4">
          <SectionHeader level={3} title="Controls" />
          <ul className="mt-2 space-y-2 text-body-sm text-fg-2">
            <li>Pot moves are one balanced journal (2100 ↔ 2110) with an Idempotency-Key, a wallet lock and balance checks. Integrity checks: <span className="ref text-[11.5px]">no_negative_green_pots</span>, <span className="ref text-[11.5px]">green_pot_move_has_one_journal</span>.</li>
            <li>An offset is an ordinary Raast payment (screening, ledger, rail, reconciliation). A certificate exists only after settlement.</li>
            <li>Staff see totals only; a customer's footprint and pot are visible to that customer alone.</li>
            <li>The assistant can describe a footprint or pot but cannot move money into or out of it.</li>
          </ul>
        </Card>
      </div>

      <div className="mt-4">
        <SectionHeader level={3} title={`Emission factors · ${f.data?.factor_set ?? "…"}`} description={f.data ? `${f.data.unit}. ±${Math.round(f.data.uncertainty * 100)}% shown to customers.` : undefined}
          actions={<Badge tone="warning">Illustrative</Badge>} />
        {f.data && <div className="mt-2"><Alert tone="warning" title="Not audited">{f.data.status}. A production version would license an environmentally-extended input-output dataset and map categories to the Pakistan Green Taxonomy.</Alert></div>}
        <div className="mt-3"><DataTable caption="Emission factors" rows={f.data?.factors || []} columns={cols} rowKey={(r) => r.category} loading={f.isLoading} /></div>
      </div>
    </Page>
  );
}
