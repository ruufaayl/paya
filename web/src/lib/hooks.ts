// Data hooks over the one query cache. Screens never invent financial values: everything shown comes from here.
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { useEffect } from "react";
import { useToast } from "../ds/toast";
import { call } from "./api";

export function useApi<T = any>(as: string | null | undefined, path: string | null, opts: Partial<UseQueryOptions<T>> = {}) {
  return useQuery<T>({
    queryKey: [as, path],
    queryFn: async () => (await call<T>(as as string, path as string)).data,
    enabled: !!as && !!path && (opts.enabled ?? true),
    ...opts,
  });
}

/** A consequential action: sends once, reports the server's answer, then refreshes affected views. */
export function useAction<TVars = void, TRes = any>(fn: (v: TVars) => Promise<TRes>, opts: {
  success?: (r: TRes, v: TVars) => string | null; invalidate?: boolean; onDone?: (r: TRes) => void;
} = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<TRes, unknown, TVars>({
    mutationFn: fn,
    onSuccess: (r, v) => {
      const msg = opts.success?.(r, v);
      if (msg) toast.ok(msg);
      if (opts.invalidate !== false) qc.invalidateQueries();
      opts.onDone?.(r);
    },
    onError: (e) => toast.error(e),
  });
}

/** Each surface sets its own theme on <html>, so portals (drawers, dialogs, toasts) match it. */
export function useTheme(theme: "wallet" | "console") {
  useEffect(() => {
    const el = document.documentElement;
    const prev = el.getAttribute("data-theme");
    el.setAttribute("data-theme", theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "console" ? "#090D12" : "#F5F6F3");
    return () => { if (prev) el.setAttribute("data-theme", prev); else el.removeAttribute("data-theme"); };
  }, [theme]);
}

export const fmtTime = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
export const fmtDateTime = (iso?: string | null) => iso ? new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
export const ago = (iso?: string | null) => {
  if (!iso) return "—";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.max(0, s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
