// Rail lab: a controlled test bench for the SIMULATED Raast rail. Pick a failure scenario, read what the
// system should do, trigger a synthetic test payment, and watch what it actually did.
import { Beaker, CircleStop, FileSearch, Play, Repeat, Siren } from "lucide-react";
import { useState } from "react";
import { paymentMeta } from "../../ds/status";
import { Alert, Badge, Button, Card, Money, Ref, SectionHeader, StatusBadge, cx } from "../../ds/ui";
import { useToast } from "../../ds/toast";
import { call, newIdempotencyKey } from "../../lib/api";
import { ago, useAction, useApi } from "../../lib/hooks";
import { Page, Restricted, useCan, useInspector, useOperator } from "../core";

/** What Paya is designed to do in each scenario (ADR-005/006/007; test ids from tests/test_scenarios.py). */
const EXPECT: Record<string, { label: string; tone: "success" | "warning" | "danger"; expect: string; recover: string; test: string }> = {
  NORMAL: { label: "Healthy", tone: "success", expect: "Rail accepts and acknowledges. Payment goes PENDING → SETTLED in about a second.", recover: "Nothing to recover.", test: "S1" },
  TIMEOUT_AFTER_ACCEPT: { label: "Lost reply", tone: "warning", expect: "Our call times out but the rail did pay. Status stays PENDING (never failed, never refunded).", recover: "Recovery agent asks the rail (5 s backoff) and settles exactly once.", test: "S4" },
  TIMEOUT_NO_RECORD: { label: "Lost request", tone: "warning", expect: "Rail never received it. Status stays PENDING.", recover: "Enquiry gets NOT_FOUND, then resends the SAME E2E id. Settles once.", test: "S4" },
  DUPLICATE_ACK: { label: "Duplicate ack", tone: "warning", expect: "Acknowledgement arrives twice.", recover: "Second ack ignored by the inbox; ledger posts SETTLE once (UNIQUE txn, posting type).", test: "S3" },
  DELAYED_ACK: { label: "Delayed response", tone: "warning", expect: "Rail accepts; the callback arrives late.", recover: "Stays PENDING until the callback or an enquiry confirms it.", test: "S4 (enquiry path)" },
  REJECT: { label: "Rejection", tone: "danger", expect: "Rail rejects after we posted the debit.", recover: "Compensating REVERSAL journal; customer funds returned. Original stays on record.", test: "S5" },
  PARTIAL: { label: "Missing line", tone: "danger", expect: "Rail pays it but leaves it out of the settlement file.", recover: "Reconciliation raises MISSING_EXTERNAL with an owned case.", test: "S10" },
  LATE_SETTLE: { label: "Late settlement file", tone: "warning", expect: "Settles into the next business day's file.", recover: "Reconciliation classes it as a timing difference, not a break.", test: "S10b" },
  DOWN: { label: "Outage", tone: "danger", expect: "Rail unreachable. Circuit breaker opens after repeated failures.", recover: "New payments are refused BEFORE any debit while the breaker is open.", test: "S12" },
};
interface Run { id: string; mode: string; txn_ref: string | null; at: string; error?: string }

export default function RailLab() { return <Restricted perm="backoffice:read"><Inner /></Restricted>; }

function Inner() {
  const { op } = useOperator();
  const can = useCan();
  const toast = useToast();
  const ins = useInspector();
  const state = useApi<any>(op.username, "/v1/chaos/rail", { refetchInterval: 3000 });
  const engine = useApi<any>(op.username, "/v1/kyc/engine");
  const [pick, setPick] = useState<string>("TIMEOUT_AFTER_ACCEPT");
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const [payer, setPayer] = useState<"sara" | "omar" | "zarak">("sara");
  const mode = state.data?.mode;
  const modes: string[] = state.data ? Object.keys(state.data.modes) : Object.keys(EXPECT);

  const apply = useAction((m: string) => call(op.username, "/v1/chaos/rail", { method: "POST", body: JSON.stringify({ mode: m }) }), { success: (_r, m) => `Rail scenario: ${EXPECT[m]?.label || m}` });
  const registry = useAction((m: string) => call(op.username, "/v1/chaos/registry", { method: "POST", body: JSON.stringify({ mode: m }) }), { success: (_r, m) => `Identity registry: ${m.toLowerCase()}` });
  const enquiry = useAction(() => call(op.username, "/v1/ops/transactions/ALL/enquiry", { method: "POST" }), { success: () => "Status enquiry sweep done" });
  const dup = useAction(() => call(op.username, "/v1/chaos/relay-duplicate", { method: "POST" }), { success: () => "Duplicate event delivered to every consumer" });

  // A test payment is made by synthetic actors (Ayesha's till, Sara's wallet), clearly labelled as such.
  const trigger = async () => {
    setBusy(true);
    const id = `run-${Date.now()}`;
    try {
      const pr = await call<any>("ayesha.cashier", "/v1/payment-requests", { method: "POST", body: JSON.stringify({ amount_minor: 1200_00, order_ref: `LAB-${Date.now().toString(36).toUpperCase()}` }) });
      const r = await call<any>(payer, "/v1/payments", { method: "POST", idempotencyKey: newIdempotencyKey(), body: JSON.stringify({ payment_request_id: pr.data.id }) });
      setRuns((x) => [{ id, mode: mode || "?", txn_ref: r.data.txn_ref, at: new Date().toISOString() }, ...x].slice(0, 12));
    } catch (e: any) {
      setRuns((x) => [{ id, mode: mode || "?", txn_ref: null, at: new Date().toISOString(), error: e?.message || "refused" }, ...x].slice(0, 12));
      toast.warn("Test payment refused", e?.message);
    } finally { setBusy(false); }
  };

  const ex = EXPECT[pick];
  return (
    <Page title="Rail lab" description="Inject failures into the simulated Raast rail and verify recovery. This is a local simulator, never real Raast infrastructure."
      actions={<Badge tone="info">Simulated rail · demo mode</Badge>}>
      {!can("chaos:control") && <div className="mb-4"><Alert tone="warning" title="Read-only for your role">Changing scenarios needs chaos:control (SysAdmin or Ops). You can still watch runs.</Alert></div>}
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <Card className="p-4">
          <SectionHeader level={3} title="1. Choose a scenario" description={<>Currently active: <b className="ref text-fg">{mode || "…"}</b>{state.data?.breaker && state.data.breaker !== "CLOSED" ? <> · circuit breaker <b className="text-danger">{state.data.breaker}</b></> : null}</>} />
          <div role="radiogroup" aria-label="Rail scenario" className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
            {modes.map((m) => {
              const e = EXPECT[m];
              return (
                <button key={m} role="radio" aria-checked={pick === m} onClick={() => setPick(m)}
                  className={cx("rounded-md border p-3 text-left transition-colors", pick === m ? "border-focus bg-hover" : "border-line hover:bg-hover")}>
                  <span className="flex items-center justify-between gap-2"><span className="text-body-sm font-semibold text-fg">{e?.label || m}</span>{mode === m && <Badge tone="processing">active</Badge>}</span>
                  <span className="ref mt-0.5 block text-[11.5px] text-fg-muted">{m}</span>
                  <span className="mt-1 block text-caption text-fg-2">{state.data?.modes?.[m]}</span>
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="p-4">
          <SectionHeader level={3} title="2. Expected behaviour" description={`Covered by automated test ${ex?.test}`} />
          {ex && <div className="mt-3 space-y-3 text-body-sm">
            <div><p className="text-overline uppercase text-fg-muted">What happens</p><p className="text-fg">{ex.expect}</p></div>
            <div><p className="text-overline uppercase text-fg-muted">How Paya recovers</p><p className="text-fg">{ex.recover}</p></div>
          </div>}
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
            <Button disabled={!can("chaos:control") || mode === pick} loading={apply.isPending} icon={<Beaker className="h-4 w-4" />} onClick={() => apply.mutate(pick)}>Apply scenario</Button>
            <Button variant="secondary" loading={busy} icon={<Play className="h-4 w-4" />} onClick={trigger}>3. Trigger test payment</Button>
            {mode !== "NORMAL" && can("chaos:control") && <Button variant="ghost" icon={<CircleStop className="h-4 w-4" />} onClick={() => apply.mutate("NORMAL")}>Restore healthy</Button>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-caption text-fg-2">
            <span>Test payment of Rs 1,200 to Chai Junction's till, paid by</span>
            <select aria-label="Test payment made by" value={payer} onChange={(e) => setPayer(e.target.value as "sara" | "omar" | "zarak")}
              className="h-8 rounded-md border border-line-control bg-surface px-2 text-caption text-fg">
              <option value="sara">Sara (synthetic, tier 2)</option><option value="omar">Omar (synthetic, tier 1)</option><option value="zarak">Zarak (synthetic, watch-list match)</option>
            </select>
            <span className="text-fg-muted">The velocity rule holds a 6th payment by one customer within 10 minutes.</span>
          </div>
        </Card>
      </div>

      <Card className="mt-4 p-4">
        <SectionHeader level={3} title="4. Observed outcome" description="Each run is followed live from the ledger. Open a run for its full timeline and postings." />
        <ul className="mt-3 divide-y divide-line">
          {runs.length === 0 && <li className="py-4 text-body-sm text-fg-2">No runs in this session yet.</li>}
          {runs.map((r) => <RunRow key={r.id} run={r} onOpen={ins.openTxn} />)}
        </ul>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <SectionHeader level={3} title="Recovery tools" />
          <div className="mt-3 grid gap-2">
            <Button variant="secondary" disabled={!can("ops:enquiry")} loading={enquiry.isPending} icon={<FileSearch className="h-4 w-4" />} onClick={() => enquiry.mutate()}>Ask the rail about all pending payments</Button>
            <Button variant="secondary" disabled={!can("chaos:control")} loading={dup.isPending} icon={<Repeat className="h-4 w-4" />} onClick={() => dup.mutate()}>Re-deliver the last settled event</Button>
          </div>
          <p className="mt-2 text-caption text-fg-muted">Duplicate delivery must change nothing: consumers are idempotent (inbox).</p>
        </Card>
        <Card className="p-4">
          <SectionHeader level={3} title="Identity registry" description="Simulated; used by onboarding." />
          <p className="mt-2 text-body-sm text-fg-2">Mode: <b className="ref text-fg">{engine.data?.registry_mode || "…"}</b></p>
          <div className="mt-3 flex gap-2">
            {["NORMAL", "TIMEOUT", "DOWN"].map((m) => <Button key={m} size="sm" variant={engine.data?.registry_mode === m ? "primary" : "secondary"} disabled={!can("chaos:control")} onClick={() => registry.mutate(m)}>{m.toLowerCase()}</Button>)}
          </div>
          <p className="mt-2 text-caption text-fg-muted">A registry that doesn't answer causes a referral, never an approval or rejection.</p>
        </Card>
        <Card className="p-4">
          <SectionHeader level={3} title="Why this matters" />
          <p className="mt-2 text-body-sm text-fg-2"><Siren className="mr-1 inline h-4 w-4 text-warning" aria-hidden />A timeout is an unknown outcome. Refunding on timeout is how a customer and a merchant both end up paid. Paya holds the payment as PENDING and asks the rail instead (ADR-006).</p>
        </Card>
      </div>
    </Page>
  );
}

function RunRow({ run, onOpen }: { run: Run; onOpen: (ref: string) => void }) {
  const { op } = useOperator();
  const d = useApi<any>(op.username, run.txn_ref ? `/v1/transactions/${run.txn_ref}` : null, { refetchInterval: (q) => (q.state.data && paymentMeta(q.state.data.status).final ? false : 1500) });
  const t = d.data;
  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5 text-body-sm">
      <Badge tone="neutral">{EXPECT[run.mode]?.label || run.mode}</Badge>
      {run.txn_ref ? <button onClick={() => onOpen(run.txn_ref!)} className="ref text-[12.5px] text-brand-accent hover:underline">{run.txn_ref}</button> : <span className="text-danger">refused: {run.error}</span>}
      {t && <StatusBadge meta={paymentMeta(t.status)} size="sm" label={t.status.replace(/_/g, " ")} />}
      {t && <span className="text-fg-2">{t.timeline.length} transitions · rail attempts {t.references.rail_e2e_id ? "≥1" : "0"}</span>}
      {t && <Money minor={t.amount.minor} className="text-fg-2" />}
      <span className="ml-auto text-caption text-fg-muted">{ago(run.at)}</span>
      {t?.references.rail_e2e_id && <Ref className="hidden text-[11px] lg:inline">{t.references.rail_e2e_id}</Ref>}
    </li>
  );
}
