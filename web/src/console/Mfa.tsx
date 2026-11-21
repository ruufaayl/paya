// Staff second factor (ADR-017). Registers the handler the API client calls when a sign-in needs a code
// (or, when enrolment is enforced, an authenticator set-up first). The password alone never opens the console.
import { QRCodeSVG } from "qrcode.react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "../ds/overlay";
import { Button, Input } from "../ds/ui";
import { ApiError, confirmMfaSetup, onSessionEnded, setMfaHandler, startMfaSetup, verifyMfa, type MfaChallenge, type Session } from "../lib/api";

interface Pending { c: MfaChallenge; resolve: (s: Session) => void; reject: (e: unknown) => void }

export function MfaPrompt() {
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    setMfaHandler((c) => new Promise<Session>((resolve, reject) => setPending({ c, resolve, reject })));
    return () => setMfaHandler(null);
  }, []);
  if (!pending) return null;
  const close = (err?: unknown) => { if (err) pending.reject(err); setPending(null); };
  return pending.c.kind === "mfa"
    ? <CodeDialog p={pending} onDone={(s) => { pending.resolve(s); setPending(null); }} onCancel={() => close(new ApiError(401, "MFA_CANCELLED", "Sign-in cancelled"))} />
    : <SetupDialog p={pending} onDone={(s) => { pending.resolve(s); setPending(null); }} onCancel={() => close(new ApiError(401, "MFA_CANCELLED", "Sign-in cancelled"))} />;
}

export function CodeField({ value, onChange, error, label = "6-digit code from your authenticator app" }: { value: string; onChange: (v: string) => void; error: string | null; label?: string }) {
  return <Input label={label} inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} value={value}
    onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))} error={error} className="num" />;
}

function CodeDialog({ p, onDone, onCancel }: { p: Pending; onDone: (s: Session) => void; onCancel: () => void }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr(null);
    try { onDone(await verifyMfa(p.c.username, p.c.challenge, code)); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Couldn't check the code"); setCode(""); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onCancel} title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4" aria-hidden />Verification code</span>}
      description={`${p.c.username} has two-step verification. Enter the current code from the authenticator app.`}
      footer={<><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button loading={busy} disabled={code.length !== 6} onClick={go}>Verify</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); if (code.length === 6) go(); }}><CodeField value={code} onChange={setCode} error={err} /></form>
    </Dialog>
  );
}

function SetupDialog({ p, onDone, onCancel }: { p: Pending; onDone: (s: Session) => void; onCancel: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; started.current = true;
    startMfaSetup(p.c.challenge).then(setSetup).catch((e) => setErr(e instanceof ApiError ? e.message : "Couldn't start set-up"));
  }, [p.c.challenge]);
  const go = async () => {
    setBusy(true); setErr(null);
    try { onDone(await confirmMfaSetup(p.c.username, p.c.challenge, code)); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Couldn't check the code"); setCode(""); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onCancel} width={480} title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" aria-hidden />Set up two-step verification</span>}
      description={`Staff accounts need a second factor. Scan this with an authenticator app (any TOTP app), then enter the code it shows.`}
      footer={<><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button loading={busy} disabled={code.length !== 6 || !setup} onClick={go}>Confirm and sign in</Button></>}>
      <SecretBlock setup={setup} />
      <form className="mt-4" onSubmit={(e) => { e.preventDefault(); if (code.length === 6) go(); }}><CodeField value={code} onChange={setCode} error={err} /></form>
    </Dialog>
  );
}

export function SecretBlock({ setup }: { setup: { secret: string; otpauth_uri: string } | null }) {
  if (!setup) return <div className="skeleton h-40 w-40" />;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="rounded-md bg-white p-2"><QRCodeSVG value={setup.otpauth_uri} size={148} aria-label="Authenticator set-up QR code" /></div>
      <div className="min-w-0 flex-1">
        <p className="text-caption text-fg-2">Or type this key:</p>
        <p className="ref mt-1 break-all text-body-sm text-fg" data-testid="mfa-secret">{setup.secret.match(/.{1,4}/g)?.join(" ")}</p>
        <p className="mt-2 text-caption text-fg-muted">Shown once. Paya stores it encrypted and never shows it again.</p>
      </div>
    </div>
  );
}

/** When the server ends the current operator's session (signed out elsewhere, revoked, MFA change). */
export function SessionEndedNotice({ username, onSignIn }: { username: string; onSignIn: () => void }) {
  const [reason, setReason] = useState<string | null>(null);
  useEffect(() => onSessionEnded((u, r) => { if (u === username) setReason(r); }), [username]);
  if (!reason) return null;
  return (
    <Dialog open onClose={() => undefined} title="Your session was ended"
      description={`The server signed ${username} out (${reason}). Nothing more can be done with the old session.`}
      footer={<Button onClick={() => { setReason(null); onSignIn(); }}>Sign in again</Button>}>
      <p className="text-body-sm text-fg-2">Signing in again starts a new session, and asks for a code if two-step verification is on. If you didn't expect this, tell an administrator.</p>
    </Dialog>
  );
}
