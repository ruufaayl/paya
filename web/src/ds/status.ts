// One status language for every Paya screen. Tone is never the only signal: every state also has an
// icon and a word. Green ("success") is reserved for outcomes the ledger has CONFIRMED (settled, reconciled,
// verified). A payment the rail has merely accepted is still "processing" (blue).
import {
  AlertTriangle, CheckCircle2, CircleDashed, Clock3, Loader2, MinusCircle, RotateCcw, ShieldAlert, UserRoundSearch, XCircle,
  type LucideIcon,
} from "lucide-react";

export type Tone = "success" | "processing" | "review" | "warning" | "danger" | "info" | "neutral";
export interface StatusMeta { tone: Tone; label: string; icon: LucideIcon; final: boolean; spin?: boolean }

export const PAYMENT_STATUS: Record<string, StatusMeta> = {
  CREATED: { tone: "processing", label: "Received", icon: CircleDashed, final: false },
  VALIDATED: { tone: "processing", label: "Checked", icon: Loader2, final: false, spin: true },
  AUTHORISED: { tone: "processing", label: "Funds reserved", icon: Loader2, final: false, spin: true },
  POSTED: { tone: "processing", label: "Posted", icon: Loader2, final: false, spin: true },
  PENDING: { tone: "processing", label: "Awaiting Raast", icon: Clock3, final: false },
  SETTLED: { tone: "success", label: "Paid", icon: CheckCircle2, final: true },
  RECONCILED: { tone: "success", label: "Reconciled", icon: CheckCircle2, final: true },
  COMPLETED: { tone: "success", label: "Completed", icon: CheckCircle2, final: true },
  UNDER_REVIEW: { tone: "review", label: "Under review", icon: UserRoundSearch, final: false },
  REVERSED: { tone: "warning", label: "Returned", icon: RotateCcw, final: true },
  REJECTED: { tone: "danger", label: "Declined", icon: XCircle, final: true },
  FAILED: { tone: "danger", label: "Failed", icon: XCircle, final: true },
  EXPIRED: { tone: "neutral", label: "Expired", icon: MinusCircle, final: true },
};

export const KYC_STATUS: Record<string, StatusMeta> = {
  STARTED: { tone: "processing", label: "Started", icon: CircleDashed, final: false },
  DOCUMENT_OK: { tone: "processing", label: "Document checked", icon: Loader2, final: false },
  REFERRED: { tone: "review", label: "Referred", icon: UserRoundSearch, final: false },
  MORE_INFO: { tone: "warning", label: "More info needed", icon: AlertTriangle, final: false },
  APPROVED: { tone: "success", label: "Approved", icon: CheckCircle2, final: true },
  REJECTED: { tone: "danger", label: "Rejected", icon: XCircle, final: true },
  ABANDONED: { tone: "neutral", label: "Abandoned", icon: MinusCircle, final: true },
};

export const CHECK_STATUS: Record<string, StatusMeta> = {
  PASS: { tone: "success", label: "Pass", icon: CheckCircle2, final: true },
  REFER: { tone: "review", label: "Refer", icon: UserRoundSearch, final: true },
  FAIL: { tone: "danger", label: "Fail", icon: XCircle, final: true },
  ERROR: { tone: "warning", label: "No answer", icon: AlertTriangle, final: true },
  WARN: { tone: "warning", label: "Warn", icon: AlertTriangle, final: true },
};

export const CASE_STATUS: Record<string, StatusMeta> = {
  OPEN: { tone: "review", label: "Open", icon: ShieldAlert, final: false },
  IN_REVIEW: { tone: "processing", label: "In review", icon: UserRoundSearch, final: false },
  RESOLVED: { tone: "success", label: "Resolved", icon: CheckCircle2, final: true },
};

export const RECON_CATEGORY: Record<string, StatusMeta & { help: string }> = {
  MATCHED: { tone: "success", label: "Matched", icon: CheckCircle2, final: true, help: "Ledger and Raast file agree" },
  TIMING_DIFFERENCE: { tone: "info", label: "Timing difference", icon: Clock3, final: false, help: "Settled after the file cut-off; expected in the next file" },
  MISSING_EXTERNAL: { tone: "danger", label: "Missing in Raast file", icon: XCircle, final: false, help: "We settled it, the rail file does not list it" },
  MISSING_INTERNAL: { tone: "danger", label: "Missing in ledger", icon: XCircle, final: false, help: "The rail paid it, we have no settled payment" },
  DUPLICATE_EXTERNAL: { tone: "warning", label: "Duplicate line", icon: AlertTriangle, final: false, help: "The same payment appears twice in the file" },
  AMOUNT_MISMATCH: { tone: "danger", label: "Amount mismatch", icon: AlertTriangle, final: false, help: "Amounts differ between ledger and rail" },
  STATUS_MISMATCH: { tone: "warning", label: "Status mismatch", icon: AlertTriangle, final: false, help: "Rail outcome differs from our status" },
};

export const TONE_CLASS: Record<Tone, { text: string; soft: string; line: string; dot: string }> = {
  success: { text: "text-success", soft: "bg-success-soft", line: "border-success-line", dot: "bg-success" },
  processing: { text: "text-processing", soft: "bg-processing-soft", line: "border-processing-line", dot: "bg-processing" },
  review: { text: "text-review", soft: "bg-review-soft", line: "border-review-line", dot: "bg-review" },
  warning: { text: "text-warning", soft: "bg-warning-soft", line: "border-warning-line", dot: "bg-warning" },
  danger: { text: "text-danger", soft: "bg-danger-soft", line: "border-danger-line", dot: "bg-danger" },
  info: { text: "text-info", soft: "bg-info-soft", line: "border-info-line", dot: "bg-info" },
  neutral: { text: "text-neutral", soft: "bg-neutral-soft", line: "border-neutral-line", dot: "bg-neutral" },
};

export function paymentMeta(status: string): StatusMeta {
  return PAYMENT_STATUS[status] || { tone: "neutral", label: status.replace(/_/g, " ").toLowerCase(), icon: MinusCircle, final: false };
}

/** Customer-facing steps of a payment, in order. */
export const JOURNEY = ["CREATED", "VALIDATED", "AUTHORISED", "POSTED", "PENDING", "SETTLED", "RECONCILED"] as const;
export const STEP_TEXT: Record<string, { title: string; body: string }> = {
  CREATED: { title: "Request received", body: "We received your request." },
  VALIDATED: { title: "Checks passed", body: "Your wallet, limits and screening rules were checked." },
  AUTHORISED: { title: "Funds reserved", body: "The amount was reserved in your wallet." },
  POSTED: { title: "Recorded in the ledger", body: "A balanced double-entry posting was written." },
  PENDING: { title: "Sent over Raast", body: "Waiting for the rail to confirm. Not paid yet." },
  SETTLED: { title: "Paid", body: "Raast confirmed it. The shop has been paid." },
  RECONCILED: { title: "Reconciled", body: "Matched against the Raast settlement file." },
  UNDER_REVIEW: { title: "Under review", body: "A person is checking this payment." },
  REVERSED: { title: "Returned to your wallet", body: "The money was returned with a compensating entry." },
  REJECTED: { title: "Declined", body: "The payment did not go ahead. No money left your wallet." },
  FAILED: { title: "Failed", body: "The payment failed." },
};
