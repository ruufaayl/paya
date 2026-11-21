// Stablecoin sandbox (Theme 5) for the bank: off by default. When on: chain height, mempool, blocks (with
// orphaned ones from reorgs), transfers with their finality, on-chain/off-chain reconciliation, chaos controls.
import { Blocks, FlaskConical, Pickaxe, Power } from "lucide-react";
import { type Column, DataTable } from "../../ds/table";
import { Alert, Badge, Button, Card, EmptyState, Metric, SectionHeader } from "../../ds/ui";
import { call } from "../../lib/api";
import { useAction, useApi } from "../../lib/hooks";
import { Page, Restricted, useCan, useOperator } from "../core";

interface T { ref: string; kind: string; to: string; beneficiary: string | null; amount_units: number; status: string; confirmations: number; reason: string | null; at: string }
interface O { enabled: boolean; flag: string; disclaimer: string; confirmations_required: number; wallets?: number; by_status?: Record<string, number>;
  chain?: { name: string; token: string; height: number; mempool: number; chaos: { mode: string; modes: string[] }; blocks: { height: number; hash: string; txs: number; orphaned: boolean; at: string }[] };
  transfers?: T[]; reconciliation?: { confirmed_checked: number; breaks: { ref: string }[] } }

export default function SandboxPage() { return <Restricted perm="backoffice:read"><Inner /></Restricted>; }
const tk = (u: number) => (u / 100).toLocaleString("en-PK", { maximumFractionDigits: 2 });

function Inner() {
  const { op } = useOperator();
  const can = useCan();
  const q = useApi<O>(op.username, "/v1/ops/sandbox", { refetchInterval: 2000 });
  const chaos = useAction(async (mode: string) => (await call(op.username, "/v1/chaos/chain", { method: "POST", body: JSON.stringify({ mode }) })).data,
    { success: (_r, m) => `Sandbox chain: ${m}` });
  const mine = useAction(async () => (await call(op.username, "/v1/ops/sandbox/mine", { method: "POST" })).data, { success: () => "Block produced" });
  const d = q.data;
  if (d && !d.enabled) return (
    <Page title="Stablecoin sandbox" description="A design prototype for a tokenised-money rail. Off by default.">
      <EmptyState icon={<Power className="h-5 w-5" />} title="Switched off on this server"
        body={<>Stablecoin payments aren't permitted for Paya under current PVARA/SBP rules, so the sandbox runs only when an operator starts the server with <span className="ref">{d.flag}=true</span>. It uses worthless test tokens on a simulated chain and never touches the rupee ledger.</>} />
    </Page>
  );
  const cols: Column<T>[] = [
    { key: "r", header: "Transfer", cell: (t) => <span className="ref text-fg">{t.ref}</span>, width: "190px" },
    { key: "k", header: "Kind", cell: (t) => <span className="text-fg-2">{t.kind.toLowerCase()}</span>, width: "90px" },
    { key: "to", header: "To", cell: (t) => <span className="text-fg-2">{t.beneficiary || <span className="ref text-[11.5px]">{t.to.slice(0, 12)}…</span>}</span> },
    { key: "a", header: "Test tokens", align: "right", cell: (t) => <span className="num">{tk(t.amount_units)}</span>, width: "120px" },
    { key: "s", header: "Status", cell: (t) => t.status === "CONFIRMED" ? <Badge tone="success">final</Badge> : t.status === "PENDING" ? <Badge tone="processing">{t.confirmations}/{d?.confirmations_required} conf.</Badge>
      : <span><Badge tone="danger">{t.status.toLowerCase()}</Badge>{t.reason && <span className="mt-0.5 block max-w-[220px] truncate text-caption text-fg-2">{t.reason}</span>}</span> },
  ];
  const rec = d?.reconciliation;
  return (
    <Page title="Stablecoin sandbox" description="Tokenised-money rail prototype: wallets, screening, limits, merchant acceptance, finality and reconciliation. Test tokens only; no rupee conversion."
      actions={can("chaos:control") && d?.chain ? <>
        {["NORMAL", "CONGESTED", "REORG", "DOWN"].map((m) => <Button key={m} size="sm" variant={d.chain!.chaos.mode === m ? "primary" : "secondary"} onClick={() => chaos.mutate(m)}>{m.toLowerCase()}</Button>)}
        <Button size="sm" variant="secondary" icon={<Pickaxe className="h-3.5 w-3.5" />} onClick={() => mine.mutate()}>Mine a block</Button></> : undefined}>
      {d && <Alert tone="warning" title="Sandbox">{d.disclaimer}</Alert>}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric label="Chain height" value={d?.chain?.height ?? "—"} icon={<Blocks className="h-3.5 w-3.5" />} sub={d?.chain ? `mode ${d.chain.chaos.mode.toLowerCase()}` : undefined} loading={!d} />
        <Metric label="Mempool" value={d?.chain?.mempool ?? "—"} sub="waiting for a block" loading={!d} />
        <Metric label="Sandbox wallets" value={d?.wallets ?? "—"} icon={<FlaskConical className="h-3.5 w-3.5" />} loading={!d} />
        <Metric label="Final / pending" value={d ? `${d.by_status?.CONFIRMED ?? 0} / ${d.by_status?.PENDING ?? 0}` : "—"} sub={`final at ${d?.confirmations_required ?? 3} confirmations`} loading={!d} />
        <Metric label="Reconciliation" value={rec ? (rec.breaks.length ? `${rec.breaks.length} breaks` : "matched") : "—"} tone={rec && rec.breaks.length ? "danger" : undefined} sub={rec ? `${rec.confirmed_checked} final transfers vs chain` : undefined} loading={!d} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_360px]">
        <div><SectionHeader level={3} title="Transfers" /><div className="mt-3"><DataTable caption="Sandbox transfers" rows={d?.transfers || []} columns={cols} rowKey={(t) => t.ref} loading={q.isLoading} empty="No sandbox transfers yet." /></div></div>
        <Card className="h-fit p-4">
          <SectionHeader level={3} title="Recent blocks" description={d?.chain?.name} />
          <ul className="mt-2 space-y-1.5 text-body-sm">
            {d?.chain?.blocks.map((b) => (
              <li key={b.hash} className="flex items-center justify-between gap-2">
                <span className="num text-fg">#{b.height}</span><span className="ref truncate text-[11.5px] text-fg-2">{b.hash}</span>
                <span className="text-caption text-fg-2">{b.txs} tx</span>{b.orphaned && <Badge tone="warning">orphaned</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Page>
  );
}
