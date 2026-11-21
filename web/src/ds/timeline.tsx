// Vertical timeline. Each item states its own status in words; the connector only shows sequence.
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { type Tone, TONE_CLASS } from "./status";
import { cx } from "./ui";

export interface TimelineItem { id: string; title: ReactNode; body?: ReactNode; at?: string | null; tone: Tone; icon: ReactNode; state: "done" | "current" | "upcoming" | "skipped" }

export function Timeline({ items, label }: { items: TimelineItem[]; label: string }) {
  return (
    <ol aria-label={label} className="relative">
      {items.map((it, i) => (
        <motion.li key={it.id} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
          className={cx("relative flex gap-3 pb-4 last:pb-0", it.state === "upcoming" && "opacity-55", it.state === "skipped" && "opacity-35")}>
          {i < items.length - 1 && <span aria-hidden className={cx("absolute left-[13px] top-7 bottom-0 w-px", it.state === "done" ? "bg-line-strong" : "bg-line")} />}
          <span aria-hidden className={cx("relative z-[1] grid h-7 w-7 shrink-0 place-items-center rounded-full border",
            it.state === "upcoming" || it.state === "skipped" ? "border-line bg-sunken text-fg-muted" : cx(TONE_CLASS[it.tone].soft, TONE_CLASS[it.tone].line, TONE_CLASS[it.tone].text))}>
            {it.icon}
          </span>
          <div className="min-w-0 pt-0.5">
            <p className="text-body-sm font-semibold text-fg">{it.title}<span className="sr-only"> ({it.state})</span></p>
            {it.body && <div className="text-body-sm text-fg-2">{it.body}</div>}
            {it.at && <time className="num text-caption text-fg-muted" dateTime={it.at}>{new Date(it.at).toLocaleString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", day: "numeric", month: "short" })}</time>}
          </div>
        </motion.li>
      ))}
    </ol>
  );
}
