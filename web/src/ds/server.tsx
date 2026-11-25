// The backend this device talks to, with a live health check. Used on the start page and the wallet sign-in
// (an iPhone Home Screen app has its own storage, so it needs the setting where it actually opens).
import { CheckCircle2, CircleAlert, Loader2, Server } from "lucide-react";
import { useEffect, useState } from "react";
import { apiBase, mixedContent, setApiBase } from "../lib/api";
import { Button, Input, cx } from "./ui";

type Health = { state: "checking" } | { state: "ok"; rail: string } | { state: "down"; why: string };

export function useServerHealth(base: string) {
  const [h, setH] = useState<Health>({ state: "checking" });
  useEffect(() => {
    let live = true;
    setH({ state: "checking" });
    if (mixedContent(base)) { setH({ state: "down", why: "This page is HTTPS, so it can't call an http:// server. Use the HTTPS (tunnel) address." }); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    fetch(`${base.replace(/\/$/, "")}/healthz`, { signal: ctl.signal })
      .then((r) => r.json()).then((j) => live && setH(j.status === "ok" ? { state: "ok", rail: j.rail_breaker } : { state: "down", why: "The server answered but is not healthy." }))
      .catch(() => live && setH({ state: "down", why: "No answer. Is the backend running and the address right?" }))
      .finally(() => clearTimeout(t));
    return () => { live = false; ctl.abort(); };
  }, [base]);
  return h;
}

export function ServerStatus({ compact = false }: { compact?: boolean }) {
  const [base, setBase] = useState(apiBase());
  const [draft, setDraft] = useState(base);
  const [open, setOpen] = useState(false);
  const h = useServerHealth(base);
  const save = () => { const v = draft.trim().replace(/\/$/, ""); setApiBase(v); setBase(v); setOpen(false); };
  const host = base.replace(/^https?:\/\//, "");
  const dot = h.state === "ok" ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> : h.state === "checking" ? <Loader2 className="h-4 w-4 animate-spin text-fg-muted" aria-hidden /> : <CircleAlert className="h-4 w-4 text-danger" aria-hidden />;
  return (
    <div className={cx("rounded-lg border border-line bg-surface", compact ? "p-3" : "p-4")} data-testid="server-status">
      <div className="flex items-center gap-2">
        <Server className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-caption text-fg-2">Rupay server</span>
          <span className="ref block truncate text-[12.5px] text-fg">{host}</span>
        </span>
        <span className="flex items-center gap-1.5 text-caption text-fg-2" role="status">{dot}{h.state === "ok" ? "Connected" : h.state === "checking" ? "Checking" : "Not reachable"}</span>
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Close" : "Change"}</Button>
      </div>
      {h.state === "down" && <p className="mt-2 text-caption text-danger">{h.why}</p>}
      {open && (
        <form className="mt-3 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Input className="flex-1" size2="md" label="Server address" placeholder="https://xxxx.trycloudflare.com" autoCapitalize="none" autoCorrect="off"
            inputMode="url" value={draft} onChange={(e) => setDraft(e.target.value)} hint="The HTTPS address of the Rupay backend (e.g. your tunnel)." />
          <Button type="submit" size="md" className="mb-6">Save</Button>
        </form>
      )}
    </div>
  );
}
