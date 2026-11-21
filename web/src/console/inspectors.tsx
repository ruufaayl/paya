// Inspectors: full, evidence-first views of a transaction, a case, or a KYC application, with the actions the
// operator's role allows. Buttons are hidden by permission for clarity, but the SERVER is the enforcement point.
import { Bot, Check, FileSearch, RotateCcw, UserPlus, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Dialog, Drawer } from "../ds/overlay";
import { CASE_STATUS, CHECK_STATUS, KYC_STATUS, RECON_CATEGORY, paymentMeta } from "../ds/status";
import { Timeline } from "../ds/timeline";
import { Alert, Badge, Button, KV, Money, Ref, Select, Skeleton, StatusBadge, cx } from "../ds/ui";
import { call } from "../lib/api";
import { fmtDateTime, fmtTime, useAction, useApi } from "../lib/hooks";
import { useCan, useInspector, useOperator } from "./core";

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-t border-line py-4 first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-overline uppercase text-fg-muted">{title}</h3>{aside}</div>
      {children}
    </section>
  );
}

function ReasonDialog({ open, onClose, title, description, confirm, onConfirm, busy, tone = "primary" }: {
  open: boolean; onClose: () => void; title: string; description: string; confirm: string; onConfirm: (reason: string) => void; busy?: boolean; tone?: "primary" | "danger";
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={tone} loading={busy} disabled={reason.trim().length < 5} onClick={() => onConfirm(reason.trim())}>{confirm}</Button></>}>
      <label className="mb-1.5 block text-label text-fg" htmlFor="reason">Reason (recorded in the audit trail)</label>
      <textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500}
        className="w-full rounded-md border border-line-control bg-canvas p-3 text-body-sm text-fg outline-none focus:border-focus" placeholder="At least 5 characters" />
    </Dialog>
  );
}

// ------------------------------------------------------------------ transaction
export function TxnInspector() {
  const ins = useInspector();
  const { op } = useOperator();
  const can = useCan();
  const q = useApi<any>(op.username, ins.txn ? `/v1/transactions/${ins.txn}` : null, { refetchInterval: 3000 });
  const [rev, setRev] = useState(false);
  const enquiry = useAction(() => call(op.username, `/v1/ops/transactions/${ins.txn}/enquiry`, { method: "POST" }), { success: () => "Status enquiry sent to the rail" });
  const reversal = useAction((reason: string) => call(op.username, `/v1/ops/transactions/${ins.txn}/reversal-requests`, { method: "POST", body: JSON.stringify({ reason }) }),
    { success: () => "Reversal requested. A Finance checker must approve it.", onDone: () => setRev(false) });
  const d = q.data;
  const meta = d ? paymentMeta(d.status) : null;
  return (
    <Drawer open={!!ins.txn} onClose={ins.close} width={640} title={<span className="ref text-fg">{ins.txn}</span>}
      description={d ? `${d.type.toLowerCase()} · ${d.merchant || "—"} · created ${fmtDateTime(d.created_at)}` : undefined}
      footer={d && (can("ops:enquiry") || can("reversal:request")) ? (
        <div className="flex flex-wrap gap-2">
          {can("ops:enquiry") && ["PENDING", "UNDER_REVIEW"].includes(d.status) && <Button size="sm" variant="secondary" icon={<FileSearch className="h-4 w-4" />} loading={enquiry.isPending} onClick={() => enquiry.mutate()}>Ask the rail now</Button>}
          {can("reversal:request") && ["PENDING", "UNDER_REVIEW"].includes(d.status) && <Button size="sm" variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setRev(true)}>Request reversal (maker)</Button>}
          <span className="self-center text-caption text-fg-muted">Actions run as {op.username}; the server checks the role.</span>
        </div>) : undefined}>
      {!d ? <div className="space-y-3"><Skeleton className="h-10 w-48" /><Skeleton className="h-40" /></div> : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Money minor={d.amount.minor} className="font-display text-amount text-fg" />
            {meta && <StatusBadge meta={meta} />}
            {d.recon_result && <Badge tone={d.recon_result === "MATCHED" ? "success" : "warning"}>recon: {d.recon_result.toLowerCase()}</Badge>}
          </div>
          {d.failure_reason && <div className="mt-3"><Alert tone="danger" title="Failure reason">{d.failure_reason}</Alert></div>}
          <div className="mt-4">
            <Section title="Lifecycle">
              <Timeline label="State transitions" items={[{ id: "c", title: "CREATED", at: d.created_at, tone: "processing", icon: <span className="h-1.5 w-1.5 rounded-full bg-current" />, state: "done" },
                ...d.timeline.map((h: any, i: number) => {
                  const m = paymentMeta(h.to);
                  return { id: `${i}`, title: <>{h.to} <span className="font-normal text-fg-muted">by {h.actor}</span></>, body: <>{h.reason?.replace(/_/g, " ")}{h.evidence && Object.keys(h.evidence).length > 0 && <pre className="mt-1 overflow-x-auto rounded bg-sunken p-2 font-mono text-[11px] text-fg-2">{JSON.stringify(h.evidence, null, 1)}</pre>}</>,
                    at: h.at, tone: m.tone, icon: <m.icon className="h-3.5 w-3.5" />, state: "done" as const };
                })]} />
            </Section>
            {d.ledger && (
              <Section title="Ledger postings (double-entry)">
                <div className="space-y-2">
                  {d.ledger.length === 0 && <p className="text-body-sm text-fg-2">No postings yet.</p>}
                  {d.ledger.map((j: any, i: number) => (
                    <div key={i} className="rounded-md border border-line">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-sunken px-3 py-1.5 text-caption">
                        <span className="font-semibold text-fg">{j.posting_type}</span>
                        <span className="text-fg-2">{j.reason_code} · {j.initiated_via} · {j.actor}{j.approved_by ? ` · approved by ${j.approved_by}` : ""}</span>
                      </div>
                      <table className="w-full text-body-sm"><tbody>
                        {j.entries.map((e: any, k: number) => (
                          <tr key={k} className="border-b border-line last:border-0">
                            <td className="px-3 py-1.5 text-fg">{e.account}</td>
                            <td className="num w-28 px-3 py-1.5 text-right text-fg">{e.direction === "D" ? `Dr ${e.amount.pkr}` : ""}</td>
                            <td className="num w-28 px-3 py-1.5 text-right text-fg">{e.direction === "C" ? `Cr ${e.amount.pkr}` : ""}</td>
                          </tr>))}
                      </tbody></table>
                    </div>
                  ))}
                </div>
              </Section>
            )}
            {d.screening?.length > 0 && (
              <Section title="Risk screening">
                {d.screening.map((s: any, i: number) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 text-body-sm">
                    <Badge tone={s.outcome === "PASS" ? "success" : s.outcome === "HOLD" ? "review" : "danger"}>{s.outcome}</Badge>
                    {s.rules_fired.length ? s.rules_fired.map((r: any) => <Ref key={r.rule}>{r.rule}</Ref>) : <span className="text-fg-2">no rules fired</span>}
                    <span className="text-caption text-fg-muted">{s.rule_version}</span>
                  </div>))}
              </Section>
            )}
            {(d.cases?.length > 0 || d.approvals?.length > 0) && (
              <Section title="Human work">
                {d.cases?.map((c: any) => (
                  <button key={c.case_ref} onClick={() => ins.openCase(c.case_ref)} className="mb-1.5 flex w-full items-center gap-2 rounded-md border border-line px-3 py-2 text-left text-body-sm hover:bg-hover">
                    <StatusBadge meta={CASE_STATUS[c.state] || CASE_STATUS.OPEN} size="sm" /><Ref>{c.case_ref}</Ref><span className="truncate text-fg-2">{c.summary}</span>
                  </button>))}
                {d.approvals?.map((a: any) => <p key={a.id} className="text-body-sm text-fg-2">{a.action}: maker <b className="text-fg">{a.maker}</b> → checker <b className="text-fg">{a.checker || "pending"}</b> ({a.status.toLowerCase()})</p>)}
              </Section>
            )}
            {d.recon?.length > 0 && <Section title="Reconciliation">{d.recon.map((r: any, i: number) => <p key={i} className="text-body-sm text-fg-2">{RECON_CATEGORY[r.category]?.label || r.category} · {fmtDateTime(r.at)}</p>)}</Section>}
            <Section title="References">
              <dl>
                <KV k="Transaction id" v={d.references.txn_id} mono />
                <KV k="Correlation id" v={d.references.correlation_id} mono />
                <KV k="Rail" v={<>{d.references.rail} <Badge tone="info">simulated</Badge></>} />
                <KV k="Raast E2E id" v={d.references.rail_e2e_id || "not sent"} mono />
              </dl>
            </Section>
            {d.audit?.length > 0 && (
              <Section title="Audit trail">
                <ul className="space-y-1">{d.audit.map((a: any, i: number) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-2 text-body-sm"><span className="num text-caption text-fg-muted">{fmtTime(a.at)}</span>
                    <Badge tone={a.outcome === "ALLOWED" ? "neutral" : "danger"}>{a.outcome}</Badge><span className="text-fg">{a.action}</span><span className="text-fg-2">by {a.actor} ({a.role})</span><Ref className="text-[11px]">#{a.row_hash}</Ref></li>))}</ul>
              </Section>
            )}
            {d.notifications?.length > 0 && <Section title="Notifications sent">{d.notifications.map((n: any, i: number) => <p key={i} className="text-body-sm text-fg-2"><b className="text-fg">{n.recipient}</b>: {n.body}</p>)}</Section>}
          </div>
        </>
      )}
      <ReasonDialog open={rev} onClose={() => setRev(false)} title="Request a reversal" description="You are the maker. A different person in Finance must approve before any money moves." confirm="Request reversal"
        busy={reversal.isPending} onConfirm={(r) => reversal.mutate(r)} />
    </Drawer>
  );
}

// ------------------------------------------------------------------ case
const RESOLUTIONS = ["RAIL_CONFIRMED_AND_REISSUED", "MATCHED_IN_LATER_FILE", "CLAIM_RAISED_WITH_PARTNER", "FEE_CONFIG_CORRECTED", "NO_ACTION_FALSE_BREAK", "WRITTEN_OFF_APPROVED"];

export function CaseInspector() {
  const ins = useInspector();
  const { op } = useOperator();
  const can = useCan();
  const q = useApi<any>(op.username, ins.case ? `/v1/cases/${ins.case}` : null);
  const c = q.data;
  const staff = useApi<any[]>(op.username, c && can("cases:assign") ? `/v1/ops/staff?role=${c.owner_role}` : null);
  const [dlg, setDlg] = useState<null | "RELEASE" | "REJECT" | "REVERSAL">(null);
  const [resolution, setResolution] = useState(RESOLUTIONS[0]);
  const ref = ins.case;
  const assign = useAction((assignee: string) => call(op.username, `/v1/cases/${ref}/assign`, { method: "POST", body: JSON.stringify({ assignee }) }), { success: (_r, a) => `Assigned to ${a}` });
  const triage = useAction(() => call(op.username, `/v1/ai/cases/${ref}/triage`, { method: "POST" }), { success: () => "AI triage requested. The suggestion appears when ready." });
  const review = useAction((v: { id: string; decision: string }) => call(op.username, `/v1/ai/suggestions/${v.id}/review`, { method: "POST", body: JSON.stringify({ decision: v.decision }) }), { success: (_r, v) => `Suggestion ${v.decision.toLowerCase()}` });
  const resolve = useAction(() => call(op.username, `/v1/cases/${ref}/resolve`, { method: "POST", body: JSON.stringify({ resolution, note: "Resolved from Mission Control with evidence reviewed" }) }), { success: () => "Case resolved" });
  const hold = useAction((v: { decision: string; reason: string }) => call(op.username, `/v1/compliance/holds/${c?.txn?.txn_ref}/decision`, { method: "POST", body: JSON.stringify(v) }),
    { success: (_r, v) => v.decision === "RELEASE" ? "Hold released; payment continues" : "Payment rejected; funds released to the customer", onDone: () => setDlg(null) });
  const reversal = useAction((reason: string) => call(op.username, `/v1/ops/transactions/${c?.txn?.txn_ref}/reversal-requests`, { method: "POST", body: JSON.stringify({ reason }) }),
    { success: () => "Reversal requested. A Finance checker must approve it.", onDone: () => setDlg(null) });
  const isOwner = c && op.role === c.owner_role;
  const ai = c?.ai?.at(-1);

  return (
    <Drawer open={!!ins.case} onClose={ins.close} width={600} title={<span className="ref text-fg">{ins.case}</span>}
      description={c ? `${c.kind.replace(/_/g, " ").toLowerCase()} · owner ${c.owner_role} · opened ${fmtDateTime(c.created_at)}` : undefined}>
      {!c ? <Skeleton className="h-40" /> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge meta={CASE_STATUS[c.state] || CASE_STATUS.OPEN} />
            {c.overdue && <Badge tone="danger">SLA overdue</Badge>}
            <span className="text-caption text-fg-2">SLA {fmtDateTime(c.sla_due_at)}</span>
          </div>
          <p className="mt-3 text-body text-fg">{c.summary}</p>
          {c.txn && <button onClick={() => ins.openTxn(c.txn.txn_ref)} className="mt-2 inline-flex items-center gap-2 text-body-sm text-brand-accent hover:underline"><Ref className="text-brand-accent">{c.txn.txn_ref}</Ref> · <Money minor={c.txn.amount.minor} /> · {c.txn.status.toLowerCase()}</button>}
          {c.application_ref && <button onClick={() => ins.openApp(c.application_ref)} className="mt-2 block text-body-sm text-brand-accent hover:underline">Open KYC application <span className="ref">{c.application_ref}</span></button>}

          <div className="mt-4">
            <Section title="Ownership" aside={!isOwner && c.state !== "RESOLVED" ? <span className="text-caption text-fg-muted">Only {c.owner_role} can assign</span> : undefined}>
              <div className="flex flex-wrap items-end gap-2">
                <p className="text-body-sm text-fg-2">Assigned to <b className="text-fg">{c.assigned_to || "nobody"}</b>{c.assigned_at ? ` · ${fmtDateTime(c.assigned_at)}` : ""}</p>
                {can("cases:assign") && isOwner && c.state !== "RESOLVED" && staff.data && (
                  <div className="ml-auto flex items-end gap-2">
                    <Select label="Assign to" hideLabel defaultValue="" onChange={(e) => e.target.value && assign.mutate(e.target.value)}>
                      <option value="" disabled>Assign to…</option>
                      {staff.data.map((s) => <option key={s.username} value={s.username}>{s.display_name}</option>)}
                    </Select>
                    {c.assigned_to !== op.username && <Button size="sm" variant="secondary" icon={<UserPlus className="h-4 w-4" />} loading={assign.isPending} onClick={() => assign.mutate(op.username)}>Take it</Button>}
                  </div>
                )}
              </div>
            </Section>

            {c.state !== "RESOLVED" && (
              <Section title="Decision">
                {c.kind === "COMPLIANCE_HOLD" && (can("compliance:decide") ? (
                  <div className="flex gap-2"><Button variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => setDlg("REJECT")}>Reject payment</Button><Button icon={<Check className="h-4 w-4" />} onClick={() => setDlg("RELEASE")}>Release hold</Button></div>
                ) : <p className="text-body-sm text-fg-2">Only Compliance can release or reject a hold. No money has moved while it waits.</p>)}
                {c.kind === "PENDING_REVIEW" && (can("reversal:request") ? <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setDlg("REVERSAL")}>Request reversal (maker)</Button>
                  : <p className="text-body-sm text-fg-2">Operations requests a reversal; Finance approves it. Two different people.</p>)}
                {c.kind === "RECON_BREAK" && (can("cases:resolve") && isOwner ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <Select label="Resolution" value={resolution} onChange={(e) => setResolution(e.target.value)}>{RESOLUTIONS.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ").toLowerCase()}</option>)}</Select>
                    <Button loading={resolve.isPending} onClick={() => resolve.mutate()}>Resolve with evidence</Button>
                  </div>) : <p className="text-body-sm text-fg-2">Only the owning role ({c.owner_role}) closes this break. Resolving moves no money.</p>)}
                {c.kind === "KYC_REVIEW" && <p className="text-body-sm text-fg-2">Decide on the KYC application itself (button above). AI is never used on identity decisions.</p>}
              </Section>
            )}

            {(c.kind === "RECON_BREAK" || c.kind === "PENDING_REVIEW") && (
              <Section title="AI suggestion · advisory only" aside={can("ai:triage") && <Button size="sm" variant="ghost" icon={<Bot className="h-4 w-4" />} loading={triage.isPending} onClick={() => triage.mutate()}>{ai ? "Re-run" : "Ask AI"}</Button>}>
                {!ai ? <p className="text-body-sm text-fg-2">No suggestion yet.</p> : (
                  <div className="rounded-md border border-review-line bg-review-soft p-3 text-body-sm">
                    <p className="font-semibold text-fg">{ai.abstained ? "Abstained: a human decides" : ai.output.next_action?.replace(/_/g, " ").toLowerCase()} <span className="font-normal text-fg-2">· confidence {Math.round((ai.output.confidence || 0) * 100)}% · {ai.engine}</span></p>
                    {ai.output.summary && <p className="mt-1 text-fg-2">{ai.output.summary}</p>}
                    {ai.output.abstain_reasons?.length > 0 && <p className="mt-1 text-caption text-fg-2">Why it abstained: {ai.output.abstain_reasons.join(", ")}</p>}
                    {ai.reviewer_decision ? <p className="mt-2 text-caption text-fg-2">Reviewed: {ai.reviewer_decision.toLowerCase()} by {ai.reviewer}</p> : can("ai:review") && isOwner && (
                      <div className="mt-2 flex gap-2"><Button size="sm" variant="secondary" onClick={() => review.mutate({ id: ai.id, decision: "OVERRIDDEN" })}>Override</Button><Button size="sm" onClick={() => review.mutate({ id: ai.id, decision: "ACCEPTED" })}>Accept suggestion</Button></div>)}
                  </div>
                )}
              </Section>
            )}

            {c.approvals?.length > 0 && <Section title="Approvals">{c.approvals.map((a: any) => <p key={a.id} className="text-body-sm text-fg-2">{a.action}: maker <b className="text-fg">{a.maker}</b>, checker <b className="text-fg">{a.checker || "waiting"}</b> · {a.status.toLowerCase()}</p>)}</Section>}
            <Section title="Details"><pre className="overflow-x-auto rounded-md bg-sunken p-3 font-mono text-[11.5px] text-fg-2">{JSON.stringify(c.details, null, 2)}</pre></Section>
            <Section title={`Decision trail (${c.audit.length})`}>
              <ul className="space-y-1.5">{c.audit.map((a: any) => (
                <li key={a.id} className="flex flex-wrap items-baseline gap-2 text-body-sm"><span className="num text-caption text-fg-muted">{fmtDateTime(a.at)}</span>
                  <Badge tone={a.outcome === "ALLOWED" ? "neutral" : "danger"}>{a.outcome}</Badge><span className="text-fg">{a.action.replace(/_/g, " ").toLowerCase()}</span><span className="text-fg-2">{a.actor} ({a.role}){a.reason ? ` · ${a.reason}` : ""}</span></li>))}
                {c.audit.length === 0 && <li className="text-body-sm text-fg-2">No decisions recorded yet.</li>}</ul>
            </Section>
          </div>
        </>
      )}
      <ReasonDialog open={dlg === "RELEASE"} onClose={() => setDlg(null)} title="Release the hold" description="The payment continues to the rail. Your decision and reason are audited." confirm="Release" busy={hold.isPending} onConfirm={(reason) => hold.mutate({ decision: "RELEASE", reason })} />
      <ReasonDialog open={dlg === "REJECT"} onClose={() => setDlg(null)} title="Reject the payment" description="The reserved funds return to the customer's available balance." confirm="Reject" tone="danger" busy={hold.isPending} onConfirm={(reason) => hold.mutate({ decision: "REJECT", reason })} />
      <ReasonDialog open={dlg === "REVERSAL"} onClose={() => setDlg(null)} title="Request a reversal" description="You are the maker. A different person in Finance must approve." confirm="Request" busy={reversal.isPending} onConfirm={(r) => reversal.mutate(r)} />
    </Drawer>
  );
}

// ------------------------------------------------------------------ KYC application
export function KycInspector() {
  const ins = useInspector();
  const { op } = useOperator();
  const can = useCan();
  const q = useApi<any>(op.username, ins.app && can("kyc:read") ? `/v1/kyc/applications/${ins.app}` : null);
  const [dlg, setDlg] = useState<null | "APPROVE" | "REJECT" | "MORE_INFO">(null);
  const decide = useAction((v: { decision: string; reason: string }) => call<any>(op.username, `/v1/compliance/kyc/${ins.app}/decision`, { method: "POST", body: JSON.stringify(v) }),
    { success: (r: any) => r.data.status === "AWAITING_SECOND_OFFICER" ? "Recommendation recorded. A second officer must confirm." : `Application ${r.data.state.toLowerCase()}`, onDone: () => setDlg(null) });
  const a = q.data;
  const latest = a ? Object.values(Object.fromEntries(a.checks.map((c: any) => [c.check, c]))) as any[] : [];
  return (
    <Drawer open={!!ins.app} onClose={ins.close} width={600} title={<span className="ref text-fg">{ins.app}</span>} description={a ? `${a.full_name} · applied ${fmtDateTime(a.created_at)}` : undefined}>
      {!can("kyc:read") ? <Alert tone="warning" title="Not available for your role">KYC evidence is visible to Compliance, Ops and Audit.</Alert> : !a ? <Skeleton className="h-40" /> : (
        <>
          <div className="flex flex-wrap items-center gap-2"><StatusBadge meta={KYC_STATUS[a.state] || KYC_STATUS.STARTED} />{a.decision && <Badge tone="neutral">{a.decision.replace(/_/g, " ").toLowerCase()}{a.decided_by ? ` by ${a.decided_by}` : ""}</Badge>}</div>
          {a.two_person_rule && (
            <div className="mt-3"><Alert tone="review" title="Two-person rule applies">Possible watch-list match. Approval needs a recommendation and a confirmation by two different compliance officers (enforced by the service and a database constraint).
              {a.recommended_by && <p className="mt-1 font-semibold text-fg">Recommended by {a.recommended_by}. Waiting for a second officer.</p>}</Alert></div>
          )}
          <div className="mt-4">
            <Section title="Applicant (synthetic)">
              <dl><KV k="Name" v={a.full_name} /><KV k="Date of birth" v={a.date_of_birth || "—"} /><KV k="Mobile" v={a.mobile} mono />
                <KV k="Document" v={a.document?.kind ? `${a.document.kind} · valid until ${a.document.expires_on}` : "not checked"} />
                <KV k="Location (≈1 km)" v={a.geolocation?.lat != null ? `${a.geolocation.lat}, ${a.geolocation.lon}` : "not shared"} mono /></dl>
            </Section>
            <Section title="Automated checks" aside={<span className="text-caption text-fg-muted">rules {a.rule_version}</span>}>
              <table className="w-full text-body-sm"><tbody>
                {latest.map((c) => (
                  <tr key={c.check} className="border-b border-line last:border-0">
                    <td className="py-2 pr-2 text-fg">{c.check.replace(/_/g, " ").toLowerCase()}</td>
                    <td className="py-2 pr-2"><StatusBadge meta={CHECK_STATUS[c.outcome]} size="sm" /></td>
                    <td className="num py-2 pr-2 text-right text-fg-2">{c.score ?? ""}</td>
                    <td className="py-2 text-caption text-fg-2">{c.reason?.replace(/_/g, " ").toLowerCase() || ""}</td>
                  </tr>))}
              </tbody></table>
              <p className="mt-2 text-caption text-fg-muted">Engines: {Array.from(new Set(latest.map((c) => c.engine))).join(", ")}. No image or face template is stored, only these results.</p>
            </Section>
            {a.reasons?.length > 0 && <Section title="Why it was referred"><div className="flex flex-wrap gap-1.5">{a.reasons.map((r: string) => <Badge key={r} tone="review">{r.replace(/_/g, " ").toLowerCase()}</Badge>)}</div></Section>}
            {a.state === "REFERRED" && (
              <Section title="Decision">
                {can("kyc:decide") ? (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => setDlg("MORE_INFO")}>Ask for new photo</Button>
                    <Button variant="danger" onClick={() => setDlg("REJECT")}>Reject</Button>
                    <Button onClick={() => setDlg("APPROVE")}>{a.two_person_rule ? (a.recommended_by ? "Confirm approval (2nd officer)" : "Recommend approval") : "Approve"}</Button>
                  </div>
                ) : <p className="text-body-sm text-fg-2">Only Compliance decides. Machines may approve clear cases; only people reject.</p>}
              </Section>
            )}
          </div>
        </>
      )}
      <ReasonDialog open={dlg === "APPROVE"} onClose={() => setDlg(null)} title="Approve this application" description="Opens a tier-1 wallet. Your reason is recorded." confirm="Approve" busy={decide.isPending} onConfirm={(reason) => decide.mutate({ decision: "APPROVE", reason })} />
      <ReasonDialog open={dlg === "REJECT"} onClose={() => setDlg(null)} title="Reject this application" description="The applicant is not told about screening reasons (no tipping off)." confirm="Reject" tone="danger" busy={decide.isPending} onConfirm={(reason) => decide.mutate({ decision: "REJECT", reason })} />
      <ReasonDialog open={dlg === "MORE_INFO"} onClose={() => setDlg(null)} title="Ask for a new ID photo" description="The applicant can retake their card photo and continue." confirm="Send request" busy={decide.isPending} onConfirm={(reason) => decide.mutate({ decision: "MORE_INFO", reason })} />
    </Drawer>
  );
}
export { cx };
