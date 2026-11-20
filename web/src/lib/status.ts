// One status language across every Paya screen.
export type Tone = "neutral" | "progress" | "success" | "warn" | "danger";

export const STATUS_TONE: Record<string, Tone> = {
  CREATED: "progress", VALIDATED: "progress", AUTHORISED: "progress", POSTED: "progress", PENDING: "progress",
  SETTLED: "success", RECONCILED: "success", COMPLETED: "success",
  UNDER_REVIEW: "warn", REVERSED: "warn", EXPIRED: "neutral", REJECTED: "danger", FAILED: "danger",
};

export const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-ink-700 text-slate-300 ring-ink-600",
  progress: "bg-sky-500/10 text-sky-400 ring-sky-500/30",
  success: "bg-paya-500/10 text-paya-300 ring-paya-500/30",
  warn: "bg-amber-500/10 text-amber-400 ring-amber-500/30",
  danger: "bg-rose-500/10 text-rose-400 ring-rose-500/30",
};

export const JOURNEY = ["CREATED", "VALIDATED", "AUTHORISED", "POSTED", "PENDING", "SETTLED", "RECONCILED"];

export const STEP_LABEL: Record<string, string> = {
  CREATED: "Request received", VALIDATED: "KYC & risk checks passed", AUTHORISED: "Funds reserved",
  POSTED: "Ledger posted", PENDING: "Sent over Raast", SETTLED: "Settled - merchant paid", RECONCILED: "Reconciled with Raast file",
  UNDER_REVIEW: "Under review by a human", REVERSED: "Returned to wallet", REJECTED: "Declined", FAILED: "Failed",
};
