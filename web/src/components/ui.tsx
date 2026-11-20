import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { STATUS_TONE, TONE_CLASS } from "../lib/status";

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const tone = STATUS_TONE[status] || "neutral";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${TONE_CLASS[tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${tone === "success" ? "bg-paya-400" : tone === "warn" ? "bg-amber-400" : tone === "danger" ? "bg-rose-400" : tone === "progress" ? "bg-sky-400 animate-pulse" : "bg-slate-400"}`} />
      {label || status.replace("_", " ")}
    </span>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2">
      <img src="/icon.svg" width={size} height={size} alt="" className="rounded-[22%]" />
      <span className="font-extrabold tracking-tight" style={{ fontSize: size * 0.72 }}>paya</span>
    </div>
  );
}

export function Button({ children, onClick, variant = "primary", disabled, className = "" }: {
  children: ReactNode; onClick?: () => void; variant?: "primary" | "ghost" | "danger" | "amber"; disabled?: boolean; className?: string;
}) {
  const styles = {
    primary: "bg-paya-400 text-ink-950 hover:bg-paya-300",
    ghost: "bg-white/5 text-slate-100 ring-1 ring-white/10 hover:bg-white/10",
    danger: "bg-rose-500 text-white hover:bg-rose-400",
    amber: "bg-amber-400 text-ink-950 hover:bg-amber-500",
  }[variant];
  return (
    <motion.button whileTap={{ scale: 0.97 }} disabled={disabled} onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition disabled:opacity-40 ${styles} ${className}`}>
      {children}
    </motion.button>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />;
}
