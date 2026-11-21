// Security (ADR-017): your two-step verification and sessions; for administrators, every staff member's
// MFA status with "end sessions" and "reset MFA" (reasons go to the audit chain).
import { KeyRound, LogOut, MonitorSmartphone, ShieldCheck, ShieldOff, UserX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "../../ds/overlay";
import { type Column, DataTable } from "../../ds/table";
import { Alert, Badge, Button, Card, Input, SectionHeader } from "../../ds/ui";
import { call } from "../../lib/api";
import { fmtDateTime, useAction, useApi } from "../../lib/hooks";
import { CodeField, SecretBlock } from "../Mfa";
import { Page, useCan, useOperator } from "../core";

interface Me { security: { mfa_enrolled: boolean; mfa_required_for_role: boolean; mfa_enforced: boolean; session_mfa: boolean } }
interface Sess { id: string; current: boolean; mfa: boolean; user_agent: string | null; created_at: string; last_seen_at: string; expires_at: string; status: string; revoked_reason: string | null }
interface StaffRow { username: string; role: string; mfa_enrolled: boolean; active_sessions: number; mfa_sessions: number }

const agent = (ua: string | null) => !ua ? "Unknown client" : /iPhone|Android/.test(ua) ? "Phone browser" : /HeadlessChrome|Playwright/.test(ua) ? "Automated browser" : /Chrome/.test(ua) ? "Chrome" : /Firefox/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : ua.slice(0, 24);

export default function Security() {
  const { op } = useOperator();
  const can = useCan();
  const me = useApi<Me>(op.username, "/v1/me");
  const sess = useApi<Sess[]>(op.username, "/v1/auth/sessions", { refetchInterval: 10000 });
  const [enrolling, setEnrolling] = useState(false);
  const others = useAction(async () => (await call(op.username, "/v1/auth/sessions/revoke-others", { method: "POST" })).data,
    { success: (r: any) => `Signed out ${r.revoked} other session${r.revoked === 1 ? "" : "s"}` });
  const revokeOne = useAction(async (id: string) => (await call(op.username, `/v1/auth/sessions/${id}/revoke`, { method: "POST" })).data,
    { success: () => "Session signed out" });
  const sec = me.data?.security;
  const cols: Column<Sess>[] = [
    { key: "c", header: "Session", cell: (s) => <span className="flex items-center gap-2 text-fg"><MonitorSmartphone className="h-4 w-4 text-fg-muted" aria-hidden />{agent(s.user_agent)}{s.current && <Badge tone="info" className="whitespace-nowrap">this one</Badge>}</span> },
    { key: "m", header: "Second factor", cell: (s) => s.mfa ? <Badge tone="success">verified</Badge> : <span className="text-fg-muted">password only</span>, width: "140px" },
    { key: "t", header: "Signed in", cell: (s) => <span className="whitespace-nowrap text-fg-2">{fmtDateTime(s.created_at)}</span>, width: "150px" },
    { key: "l", header: "Last active", cell: (s) => <span className="whitespace-nowrap text-fg-2">{fmtDateTime(s.last_seen_at)}</span>, width: "150px" },
    { key: "s", header: "Status", cell: (s) => s.status === "active" ? <Badge tone="neutral">active</Badge> : <span className="text-fg-muted">{s.status}{s.revoked_reason ? ` · ${s.revoked_reason}` : ""}</span> },
    { key: "a", header: "", align: "right", width: "110px", cell: (s) => s.status === "active" && !s.current
      ? <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); revokeOne.mutate(s.id); }}>Sign out</Button> : null },
  ];
  return (
    <Page title="Security" description="Two-step verification and sign-in sessions. Signing a session out stops its token on the very next request.">
      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <Card className="h-fit p-4">
          <SectionHeader level={3} title="Two-step verification" />
          {sec && (sec.mfa_enrolled ? (
            <Alert tone="success" title="On" icon={<ShieldCheck className="h-4 w-4" />}>Signing in as {op.username} needs a code from your authenticator app.</Alert>
          ) : (
            <>
              <Alert tone={sec.mfa_enforced ? "danger" : "warning"} title="Off" icon={<ShieldOff className="h-4 w-4" />}>
                {sec.mfa_enforced ? "This server requires it for staff." : "Demo mode doesn't require it, but staff accounts should use it. Once it's on, the password alone won't sign you in."}
              </Alert>
              <Button className="mt-3" icon={<KeyRound className="h-4 w-4" />} onClick={() => setEnrolling(true)}>Turn on two-step verification</Button>
            </>
          ))}
          <p className="mt-3 text-caption text-fg-2">Codes follow RFC 6238 (any authenticator app). Each code works once; five wrong codes pause sign-in for five minutes. The key is stored encrypted.</p>
        </Card>
        <div>
          <SectionHeader level={3} title="Your sessions" actions={<Button size="sm" variant="secondary" icon={<LogOut className="h-3.5 w-3.5" />} loading={others.isPending} onClick={() => others.mutate()}>Sign out everywhere else</Button>} />
          <div className="mt-3"><DataTable caption="Your sessions" rows={sess.data || []} columns={cols} rowKey={(s) => s.id} loading={sess.isLoading} /></div>
        </div>
      </div>
      {can("sessions:revoke") && <AdminPanel as={op.username} />}
      {enrolling && <EnrolDialog as={op.username} onClose={() => setEnrolling(false)} />}
    </Page>
  );
}

function EnrolDialog({ as, onClose }: { as: string; onClose: () => void }) {
  // One secret per dialog: requested once, never re-fetched while the person is scanning it.
  const [start, setStart] = useState<{ data?: { secret: string; otpauth_uri: string } }>({});
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return; asked.current = true;
    call<{ secret: string; otpauth_uri: string }>(as, "/v1/auth/mfa/enrol", { method: "POST" }).then((r) => setStart({ data: r.data })).catch(() => onClose());
  }, [as, onClose]);
  const [code, setCode] = useState("");
  const confirm = useAction(async () => (await call(as, "/v1/auth/mfa/enrol/confirm", { method: "POST", body: JSON.stringify({ code }) })).data,
    { success: () => "Two-step verification is on. Your other sessions were signed out.", onDone: onClose });
  return (
    <Dialog open onClose={onClose} width={480} title="Turn on two-step verification"
      description="Scan the code with an authenticator app, then enter the 6-digit code it shows to confirm."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={confirm.isPending} disabled={code.length !== 6 || !start.data} onClick={() => confirm.mutate()}>Confirm</Button></>}>
      <SecretBlock setup={start.data || null} />
      <form className="mt-4" onSubmit={(e) => { e.preventDefault(); if (code.length === 6) confirm.mutate(); }}><CodeField value={code} onChange={setCode} error={null} /></form>
    </Dialog>
  );
}

function AdminPanel({ as }: { as: string }) {
  const q = useApi<StaffRow[]>(as, "/v1/admin/staff-security", { refetchInterval: 10000 });
  const [target, setTarget] = useState<{ row: StaffRow; action: "revoke" | "reset" } | null>(null);
  const cols: Column<StaffRow>[] = [
    { key: "u", header: "Staff member", cell: (r) => <span className="text-fg">{r.username}</span> },
    { key: "r", header: "Role", cell: (r) => <span className="text-fg-2">{r.role}</span>, width: "130px" },
    { key: "m", header: "Two-step", cell: (r) => r.mfa_enrolled ? <Badge tone="success">on</Badge> : <Badge tone="warning">off</Badge>, width: "110px" },
    { key: "s", header: "Active sessions", align: "right", cell: (r) => <span className="num">{r.active_sessions}{r.active_sessions ? ` (${r.mfa_sessions} with code)` : ""}</span>, width: "170px" },
    { key: "a", header: "", align: "right", width: "230px", cell: (r) => (
      <span className="flex justify-end gap-1.5">
        <Button size="sm" variant="secondary" icon={<UserX className="h-3.5 w-3.5" />} disabled={!r.active_sessions} onClick={(e) => { e.stopPropagation(); setTarget({ row: r, action: "revoke" }); }}>End sessions</Button>
        {r.mfa_enrolled && r.username !== as && <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setTarget({ row: r, action: "reset" }); }}>Reset</Button>}
      </span>) },
  ];
  return (
    <div className="mt-6">
      <SectionHeader level={3} title="Staff accounts (administrator)" description="End a person's sessions (e.g. a lost laptop) or reset their two-step verification after checking who they are. You can't reset your own." />
      <div className="mt-3"><DataTable caption="Staff security" rows={q.data || []} columns={cols} rowKey={(r) => r.username} loading={q.isLoading} /></div>
      {target && <ReasonDialog as={as} target={target} onClose={() => setTarget(null)} />}
    </div>
  );
}

function ReasonDialog({ as, target, onClose }: { as: string; target: { row: StaffRow; action: "revoke" | "reset" }; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const path = target.action === "revoke" ? `/v1/admin/users/${target.row.username}/sessions/revoke` : `/v1/admin/users/${target.row.username}/mfa/reset`;
  const act = useAction(async () => (await call(as, path, { method: "POST", body: JSON.stringify({ reason }) })).data,
    { success: (r: any) => target.action === "revoke" ? `Ended ${r.sessions_revoked} session(s) for ${target.row.username}` : `Two-step verification reset for ${target.row.username}`, onDone: onClose });
  return (
    <Dialog open onClose={onClose} title={target.action === "revoke" ? `End all sessions for ${target.row.username}?` : `Reset two-step verification for ${target.row.username}?`}
      description={target.action === "revoke" ? "Their tokens stop working on the next request. They can sign in again." : "Their authenticator is removed and every session ends. Do this only after confirming their identity."}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" loading={act.isPending} disabled={reason.trim().length < 5} onClick={() => act.mutate()}>{target.action === "revoke" ? "End sessions" : "Reset"}</Button></>}>
      <Input label="Reason (goes into the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
    </Dialog>
  );
}
