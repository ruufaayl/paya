// Accessible data table: real <table>, sticky header, keyboard-activatable rows, pagination.
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cx, IconButton, Skeleton } from "./ui";

export interface Column<T> { key: string; header: ReactNode; cell: (row: T) => ReactNode; align?: "left" | "right"; width?: string; className?: string }

export function DataTable<T>({ rows, columns, rowKey, onRowClick, loading, empty, caption, selectedKey }: {
  rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void; loading?: boolean;
  empty?: ReactNode; caption: string; selectedKey?: string | null;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface scrollbar-thin">
      <table className="w-full min-w-[720px] border-collapse text-body-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-[1] bg-sunken">
          <tr>{columns.map((c) => (
            <th key={c.key} scope="col" style={{ width: c.width }} className={cx("border-b border-line px-3 py-2.5 text-left text-overline uppercase text-fg-muted", c.align === "right" && "text-right")}>{c.header}</th>
          ))}</tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 && Array.from({ length: 6 }).map((_, i) => (
            <tr key={i}>{columns.map((c) => <td key={c.key} className="border-b border-line px-3 py-3"><Skeleton className="h-4 w-full" /></td>)}</tr>
          ))}
          {!loading && rows.length === 0 && <tr><td colSpan={columns.length} className="px-3 py-10 text-center text-fg-2">{empty || "Nothing to show"}</td></tr>}
          {rows.map((r) => {
            const k = rowKey(r);
            return (
              <tr key={k} tabIndex={onRowClick ? 0 : undefined} aria-selected={selectedKey === k || undefined}
                onClick={() => onRowClick?.(r)} onKeyDown={(e) => { if (onRowClick && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onRowClick(r); } }}
                className={cx("transition-colors duration-fast", onRowClick && "cursor-pointer hover:bg-hover focus-visible:bg-hover", selectedKey === k && "bg-hover")}>
                {columns.map((c) => <td key={c.key} className={cx("border-b border-line px-3 py-2.5 align-middle text-fg", c.align === "right" && "text-right", c.className)}>{c.cell(r)}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 text-body-sm text-fg-2">
      <span className="num">{from}–{Math.min(total, page * pageSize)} of {total}</span>
      <div className="flex items-center gap-1">
        <IconButton label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} className="disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></IconButton>
        <span className="num px-2">Page {page} of {pages}</span>
        <IconButton label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)} className="disabled:opacity-40"><ChevronRight className="h-4 w-4" /></IconButton>
      </div>
    </nav>
  );
}
