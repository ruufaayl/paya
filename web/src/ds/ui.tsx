// Rupay design-system primitives. Semantic tokens only (no raw colours), so they work in both themes.
import { motion } from "framer-motion";
import { Loader2, Search, X } from "lucide-react";
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { type StatusMeta, TONE_CLASS, type Tone } from "./status";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

// ------------------------------------------------------------------ brand
/** The Rupay symbol: an "R" with a light leg. Flat, two colours. */
export function Symbol({ size = 28, tone = "brand", title }: { size?: number; tone?: "brand" | "mono" | "inverse"; title?: string }) {
  const bg = tone === "inverse" ? "rgb(var(--night-fg))" : "rgb(var(--night))";
  const mark = tone === "mono" ? "rgb(var(--night-fg))" : tone === "inverse" ? "rgb(var(--night))" : "#2FD195";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <rect width="64" height="64" rx="15" fill={bg} />
      <path d="M20 48V16h14c7.5 0 12 4.3 12 10.6S41.5 37.2 34 37.2H20" fill="none" stroke={mark} strokeWidth="5.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M31 37.4L45 48" fill="none" stroke={tone === "inverse" ? "rgb(var(--night-fg))" : "#F0F7F4"} strokeWidth="5.6" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ size = 28, tone = "brand", suffix }: { size?: number; tone?: "brand" | "mono" | "inverse"; suffix?: string }) {
  return (
    <span className="inline-flex items-center gap-2" role="img" aria-label={`Rupay${suffix ? ` ${suffix}` : ""}`}>
      <Symbol size={size} tone={tone} />
      <span className="font-display font-extrabold tracking-[-0.04em] text-fg" style={{ fontSize: size * 0.78, lineHeight: 1 }} aria-hidden>rupay</span>
      {suffix && <span className="ml-1 border-l border-line-strong pl-2.5 text-label text-fg-2" aria-hidden>{suffix}</span>}
    </span>
  );
}

// ------------------------------------------------------------------ buttons
type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type BtnSize = "sm" | "md" | "lg";
const BTN: Record<BtnVariant, string> = {
  primary: "bg-brand text-brand-fg hover:bg-brand-strong shadow-e1",
  secondary: "bg-surface text-fg border border-line-control/60 hover:bg-hover",
  ghost: "bg-transparent text-fg-2 hover:bg-hover hover:text-fg",
  danger: "bg-danger text-white hover:opacity-90",
  subtle: "bg-sunken text-fg hover:bg-hover",
};
const SIZE: Record<BtnSize, string> = { sm: "h-8 px-3 text-label gap-1.5 rounded-sm", md: "h-10 px-4 text-body-sm font-semibold gap-2 rounded-md", lg: "h-[52px] px-5 text-body font-semibold gap-2 rounded-lg" };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant; size?: BtnSize; loading?: boolean; icon?: ReactNode; block?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, block, className, children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} disabled={disabled || loading} aria-busy={loading || undefined}
      className={cx("inline-flex select-none items-center justify-center whitespace-nowrap transition-[background,opacity,transform] duration-fast ease-standard active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45",
        BTN[variant], SIZE[size], block && "w-full", className)} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button aria-label={label} title={label} className={cx("grid h-9 w-9 place-items-center rounded-md text-fg-2 transition-colors duration-fast hover:bg-hover hover:text-fg", className)} {...rest}>
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ surfaces
export function Card({ children, className, as: Tag = "div", ...rest }: { children: ReactNode; className?: string; as?: any } & Record<string, any>) {
  return <Tag className={cx("rounded-lg border border-line bg-surface shadow-e1", className)} {...rest}>{children}</Tag>;
}

export function SectionHeader({ title, description, actions, level = 2 }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; level?: 2 | 3 }) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <H className={level === 2 ? "text-title-2 text-fg" : "text-title-3 text-fg"}>{title}</H>
        {description && <p className="mt-0.5 text-body-sm text-fg-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ status
export function StatusBadge({ meta, size = "md", label }: { meta: StatusMeta; size?: "sm" | "md"; label?: string }) {
  const t = TONE_CLASS[meta.tone];
  const Icon = meta.icon;
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border font-semibold", t.text, t.soft, t.line,
      size === "sm" ? "px-2 py-0.5 text-[11.5px]" : "px-2.5 py-1 text-caption")}>
      <Icon className={cx(size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5", meta.spin && "animate-spin")} aria-hidden />
      {label || meta.label}
    </span>
  );
}

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  const t = TONE_CLASS[tone];
  return <span className={cx("inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11.5px] font-semibold", t.text, t.soft, t.line, className)}>{children}</span>;
}

export function Dot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  return <span aria-hidden className={cx("inline-block h-2 w-2 shrink-0 rounded-full", TONE_CLASS[tone].dot, pulse && "animate-pulse-dot")} />;
}

export function Alert({ tone = "info", title, children, icon, action }: { tone?: Tone; title?: ReactNode; children?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  const t = TONE_CLASS[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("flex gap-3 rounded-md border p-3", t.soft, t.line)}>
      {icon && <span className={cx("mt-0.5 shrink-0", t.text)} aria-hidden>{icon}</span>}
      <div className="min-w-0 flex-1 text-body-sm text-fg">
        {title && <p className={cx("font-semibold", t.text)}>{title}</p>}
        {children && <div className="text-fg-2">{children}</div>}
      </div>
      {action}
    </div>
  );
}

// ------------------------------------------------------------------ data
export const pkr = (minor: number, opts: { sign?: boolean; decimals?: boolean } = {}) => {
  const v = Math.abs(minor) / 100;
  const s = v.toLocaleString("en-PK", { minimumFractionDigits: opts.decimals ? 2 : 0, maximumFractionDigits: 2 });
  return `${opts.sign ? (minor < 0 ? "−" : "+") : minor < 0 ? "−" : ""}Rs ${s}`;
};

export function Money({ minor, className, sign, decimals }: { minor: number; className?: string; sign?: boolean; decimals?: boolean }) {
  return <span className={cx("num", className)}>{pkr(minor, { sign, decimals })}</span>;
}

export function Ref({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("ref whitespace-nowrap text-[12.5px] text-fg-2", className)}>{children}</span>;
}

export function KV({ k, v, mono }: { k: ReactNode; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-body-sm text-fg-2">{k}</dt>
      <dd className={cx("min-w-0 truncate text-right text-body-sm text-fg", mono && "ref")}>{v}</dd>
    </div>
  );
}

export function Metric({ label, value, sub, tone, icon, loading }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; icon?: ReactNode; loading?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center gap-2 text-overline uppercase text-fg-muted">{icon}<span className="truncate">{label}</span></div>
      {loading ? <div className="skeleton mt-2 h-7 w-24" /> :
        <motion.div key={String(value)} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} className={cx("num mt-1.5 font-display text-[1.65rem] font-extrabold leading-8 tracking-tight", tone ? TONE_CLASS[tone].text : "text-fg")}>{value}</motion.div>}
      {sub && <div className="mt-1 truncate text-caption text-fg-2">{sub}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ feedback
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("skeleton", className)} />;
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong px-6 py-10 text-center">
      {icon && <span className="mb-1 grid h-11 w-11 place-items-center rounded-full bg-sunken text-fg-muted" aria-hidden>{icon}</span>}
      <p className="text-title-3 text-fg">{title}</p>
      {body && <p className="max-w-sm text-body-sm text-fg-2">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <Loader2 className={cx("animate-spin text-fg-muted", className)} aria-label="Loading" />;
}

// ------------------------------------------------------------------ forms
interface FieldWrap { label: string; hint?: ReactNode; error?: string | null; }
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldWrap & { size2?: "md" | "lg" }>(function Input(
  { label, hint, error, className, size2 = "lg", id, ...rest }, ref) {
  const auto = useId();
  const fid = id || auto;
  return (
    <div className={className}>
      <label htmlFor={fid} className="mb-1.5 block text-label text-fg">{label}</label>
      <input ref={ref} id={fid} aria-invalid={!!error || undefined} aria-describedby={hint || error ? `${fid}-d` : undefined}
        className={cx("w-full rounded-md border bg-surface px-3.5 text-body text-fg outline-none transition-colors duration-fast placeholder:text-fg-muted focus:border-focus focus-visible:outline-none focus:ring-2 focus:ring-focus/30",
          size2 === "lg" ? "h-12" : "h-10", error ? "border-danger" : "border-line-control")} {...rest} />
      {(error || hint) && <p id={`${fid}-d`} className={cx("mt-1.5 text-caption", error ? "text-danger" : "text-fg-2")}>{error || hint}</p>}
    </div>
  );
});

export function Select({ label, children, className, hideLabel, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hideLabel?: boolean }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className={cx("mb-1.5 block text-label text-fg", hideLabel && "sr-only")}>{label}</label>
      <select id={id} className="h-10 w-full rounded-md border border-line-control bg-surface px-3 text-body-sm text-fg outline-none focus:border-focus focus:ring-2 focus:ring-focus/30" {...rest}>{children}</select>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder, label = "Search", className, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string; className?: string; autoFocus?: boolean }) {
  return (
    <div className={cx("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" aria-hidden />
      <input type="search" aria-label={label} value={value} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="h-10 w-full rounded-md border border-line-control bg-surface pl-9 pr-9 text-body-sm text-fg outline-none placeholder:text-fg-muted focus:border-focus focus:ring-2 focus:ring-focus/30" />
      {value && <button aria-label="Clear search" onClick={() => onChange("")} className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-fg-muted hover:text-fg"><X className="h-3.5 w-3.5" /></button>}
    </div>
  );
}

// ------------------------------------------------------------------ tabs (WAI-ARIA tabs pattern)
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex gap-1 rounded-md border border-line bg-sunken p-1"
      onKeyDown={(e) => {
        const i = tabs.findIndex((t) => t.id === value);
        if (e.key === "ArrowRight") onChange(tabs[(i + 1) % tabs.length].id);
        if (e.key === "ArrowLeft") onChange(tabs[(i - 1 + tabs.length) % tabs.length].id);
      }}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1} onClick={() => onChange(t.id)}
          className={cx("relative rounded-sm px-3 py-1.5 text-label transition-colors duration-fast", t.id === value ? "text-fg" : "text-fg-2 hover:text-fg")}>
          {t.id === value && <motion.span layoutId={`tab-${label}`} className="absolute inset-0 rounded-sm bg-surface shadow-e1" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
          <span className="relative flex items-center gap-1.5">{t.label}{t.count != null && <span className="num rounded bg-hover px-1 text-[11px] text-fg-2">{t.count}</span>}</span>
        </button>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-sunken px-1.5 py-0.5 font-mono text-[11px] text-fg-2">{children}</kbd>;
}
