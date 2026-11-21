// Small, dependency-free SVG charts. Every chart: real data only, a legend for >= 2 series, a hover tooltip,
// a text alternative (visually hidden table), and no colour-only meaning (legend has icons + words).
// Series colours were validated for colour-blind separation on the console surface (dataviz validator):
// settled #2FA36B, in flight #3D7FE6, failed #E0603A, review #A86BC0 (stack order fixed, never cycled).
import { useMemo, useState, type ReactNode } from "react";

export interface Series { key: string; label: string; color: string; icon?: ReactNode }

export function StackedBars({ data, series, height = 180, xLabel, format = (n: number) => String(n), title }: {
  data: (Record<string, any> & { label: string })[]; series: Series[]; height?: number; xLabel?: string;
  format?: (n: number) => string; title: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => series.reduce((a, s) => a + (d[s.key] || 0), 0)));
  const nice = Math.max(1, Math.ceil(max / 4)) * 4;
  const W = 600, H = height, padL = 32, padB = 22, padT = 8;
  const bw = (W - padL) / Math.max(1, data.length);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / nice);
  const empty = data.every((d) => series.every((s) => !d[s.key]));
  return (
    <figure className="relative">
      <figcaption className="sr-only">{title}</figcaption>
      <Legend series={series} />
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={W} y1={y(nice * f)} y2={y(nice * f)} stroke="rgb(var(--line))" strokeWidth={1} />
            <text x={padL - 6} y={y(nice * f) + 4} textAnchor="end" className="fill-[rgb(var(--fg-muted))] text-[10px] num">{Math.round(nice * f)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          let acc = 0;
          const x = padL + i * bw;
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={x} y={padT} width={bw} height={H - padT - padB} fill={hover === i ? "rgb(var(--fg) / 0.05)" : "transparent"} />
              {series.map((s) => {
                const v = d[s.key] || 0;
                if (!v) return null;
                const y0 = y(acc), y1 = y(acc + v);
                acc += v;
                return <rect key={s.key} x={x + Math.max(1, bw * 0.18)} width={Math.max(2, bw * 0.64)} y={y1} height={Math.max(0, y0 - y1 - 2)} rx={2} fill={s.color} />;
              })}
            </g>
          );
        })}
        {data.map((d, i) => (i % Math.ceil(data.length / 6) === 0 ? (
          <text key={`l${i}`} x={padL + i * bw + bw / 2} y={H - 6} textAnchor="middle" className="fill-[rgb(var(--fg-muted))] text-[10px] num">{d.label}</text>
        ) : null))}
        {empty && <text x={(W + padL) / 2} y={H / 2} textAnchor="middle" className="fill-[rgb(var(--fg-muted))] text-[12px]">No payments in this window yet</text>}
      </svg>
      {hover != null && !empty && (
        <div className="pointer-events-none absolute top-8 z-10 min-w-[160px] rounded-md border border-line bg-raised p-2.5 text-caption shadow-e2"
          style={{ left: `clamp(0px, calc(${((padL + hover * bw) / W) * 100}% - 40px), calc(100% - 170px))` }}>
          <p className="mb-1 font-semibold text-fg">{data[hover].label}{xLabel ? ` · ${xLabel}` : ""}</p>
          {series.map((s) => (
            <p key={s.key} className="flex items-center justify-between gap-4 text-fg-2">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.label}</span>
              <span className="num text-fg">{format(data[hover][s.key] || 0)}</span>
            </p>
          ))}
        </div>
      )}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr><th>Time</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}</tr></thead>
        <tbody>{data.map((d, i) => <tr key={i}><td>{d.label}</td>{series.map((s) => <td key={s.key}>{d[s.key] || 0}</td>)}</tr>)}</tbody>
      </table>
    </figure>
  );
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-fg-2" aria-label="Legend">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.icon}{s.label}
        </li>
      ))}
    </ul>
  );
}

/** Single-series line with a crosshair tooltip. Gaps (null) break the line instead of inventing values. */
export function LineChart({ points, height = 120, format = (n: number) => String(n), title, color = "#3D7FE6" }: {
  points: { label: string; value: number | null }[]; height?: number; format?: (n: number) => string; title: string; color?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const vals = points.map((p) => p.value).filter((v): v is number => v != null);
  const max = Math.max(1, ...vals) * 1.15;
  const W = 600, H = height, padL = 32, padB = 18, padT = 8;
  const step = (W - padL) / Math.max(1, points.length - 1);
  const xy = (i: number, v: number) => [padL + i * step, padT + (H - padT - padB) * (1 - v / max)];
  const path = useMemo(() => {
    let d = "", pen = false;
    points.forEach((p, i) => {
      if (p.value == null) { pen = false; return; }
      const [x, yy] = xy(i, p.value);
      d += `${pen ? "L" : "M"}${x.toFixed(1)},${yy.toFixed(1)} `;
      pen = true;
    });
    return d;
  }, [points, max]);
  return (
    <figure className="relative">
      <figcaption className="sr-only">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title} onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGElement).getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(points.length - 1, Math.round((x - padL) / step))));
        }}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={W} y1={padT + (H - padT - padB) * (1 - f)} y2={padT + (H - padT - padB) * (1 - f)} stroke="rgb(var(--line))" />
            <text x={padL - 6} y={padT + (H - padT - padB) * (1 - f) + 4} textAnchor="end" className="fill-[rgb(var(--fg-muted))] text-[10px] num">{format(max * f)}</text>
          </g>
        ))}
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && points[hover]?.value != null && (() => {
          const [x, yy] = xy(hover, points[hover].value as number);
          return <g><line x1={x} x2={x} y1={padT} y2={H - padB} stroke="rgb(var(--line-strong))" /><circle cx={x} cy={yy} r={4.5} fill={color} stroke="rgb(var(--surface))" strokeWidth={2} /></g>;
        })()}
        {vals.length === 0 && <text x={(W + padL) / 2} y={H / 2} textAnchor="middle" className="fill-[rgb(var(--fg-muted))] text-[12px]">No settled payments yet</text>}
      </svg>
      {hover != null && points[hover]?.value != null && (
        <div className="pointer-events-none absolute top-0 rounded-md border border-line bg-raised px-2.5 py-1.5 text-caption shadow-e2"
          style={{ left: `clamp(0px, calc(${((padL + hover * step) / W) * 100}% - 50px), calc(100% - 120px))` }}>
          <span className="text-fg-2">{points[hover].label}</span> <span className="num font-semibold text-fg">{format(points[hover].value as number)}</span>
        </div>
      )}
    </figure>
  );
}

/** Proportion bar (a single 100% bar with gaps) - used instead of a donut for category shares. */
export function ShareBar({ parts, title }: { parts: { label: string; value: number; color: string }[]; title: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <figure>
      <figcaption className="sr-only">{title}</figcaption>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-sunken" role="img" aria-label={`${title}: ${parts.map((p) => `${p.label} ${p.value}`).join(", ")}`}>
        {parts.filter((p) => p.value > 0).map((p) => <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />)}
      </div>
    </figure>
  );
}
