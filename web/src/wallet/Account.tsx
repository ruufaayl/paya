// Account: who you are, your verification and limits, how Paya protects your money, and sign out.
import { BadgeCheck, BookOpenCheck, FlaskConical, KeyRound, LifeBuoy, LogOut, Repeat2, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, KV, Skeleton } from "../ds/ui";
import { apiBase, session } from "../lib/api";
import { useWallet } from "./Home";

export default function Account({ user, onSignOut }: { user: string; onSignOut: () => void }) {
  const { data: w } = useWallet(user);
  const s = session(user);
  const tier = w?.customer.kyc_tier;
  const row = (Icon: any, title: string, body: string) => (
    <li className="flex gap-3 py-2.5"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-accent" aria-hidden /><div><p className="text-body-sm font-semibold text-fg">{title}</p><p className="text-caption text-fg-2">{body}</p></div></li>
  );
  return (
    <div className="safe-top px-5 pb-8">
      <h1 className="pt-4 text-title-1 text-fg">Account</h1>
      <Card className="mt-4 flex items-center gap-4 p-4">
        <span aria-hidden className="grid h-14 w-14 place-items-center rounded-full bg-night font-display text-title-2 text-night-fg">{(s?.display_name || user)[0]}</span>
        <div className="min-w-0">
          <p className="truncate text-title-3 text-fg">{s?.display_name || user}</p>
          <p className="ref text-[12px] text-fg-muted">@{user}</p>
          {w ? <span className="mt-1 inline-flex items-center gap-1 text-caption font-semibold text-success"><BadgeCheck className="h-3.5 w-3.5" aria-hidden />{w.customer.kyc_status === "VERIFIED" ? `Verified · tier ${tier}` : w.customer.kyc_status.toLowerCase()}</span> : <Skeleton className="mt-1 h-3 w-24" />}
        </div>
      </Card>

      <Card as="section" aria-labelledby="lim-h" className="mt-3 px-4 py-2">
        <h2 id="lim-h" className="pt-2 text-title-3 text-fg">Limits</h2>
        <dl>
          <KV k="Per payment" v={tier === 2 ? "Rs 500,000" : tier === 1 ? "Rs 25,000" : "Not available"} />
          <KV k="Velocity rule" v="5 payments per 10 minutes, then a review" />
        </dl>
      </Card>

      <Card as="section" aria-labelledby="sec-h" className="mt-3 px-4 py-2">
        <h2 id="sec-h" className="pt-2 text-title-3 text-fg">How Paya protects your money</h2>
        <ul className="divide-y divide-line">
          {row(BookOpenCheck, "Every rupee is double-entry", "Each payment is a balanced ledger posting that can never be edited, only corrected.")}
          {row(Repeat2, "Retries can't charge twice", "Each payment carries a unique key; resending returns the same result.")}
          {row(ShieldCheck, "\"Paid\" means confirmed", "We only show Paid after Raast confirms. A timeout means pending, never failed or refunded.")}
          {row(KeyRound, "People check people", "Reversals need two staff members; risky approvals need two compliance officers.")}
        </ul>
      </Card>

      <Card as="section" aria-labelledby="demo-h" className="mt-3 px-4 py-3">
        <h2 id="demo-h" className="flex items-center gap-2 text-title-3 text-fg"><FlaskConical className="h-4 w-4" aria-hidden />About this prototype <Badge tone="info">Synthetic</Badge></h2>
        <p className="mt-1 text-caption text-fg-2">Paya is an academic prototype. People, merchants and identities are synthetic; the Raast rail and identity registry are simulators; no real money moves.</p>
        <dl className="mt-2"><KV k="Server" v={apiBase().replace(/^https?:\/\//, "")} mono /></dl>
      </Card>

      <Card className="mt-3 flex items-center gap-3 px-4 py-3 text-body-sm text-fg-2"><LifeBuoy className="h-4 w-4" aria-hidden />Support: quote your payment reference from the receipt.</Card>
      <Button variant="secondary" size="lg" block className="mt-5" icon={<LogOut className="h-4 w-4" />} onClick={onSignOut}>Sign out</Button>
    </div>
  );
}
