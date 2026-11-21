// Toasts report what the SERVER said. They are announced politely to screen readers (aria-live).
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, ShieldAlert, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../lib/api";
import { TONE_CLASS } from "./status";

type Tone = "success" | "warning" | "danger" | "info";
interface T { id: number; title: string; body?: string; tone: Tone }
const Ctx = createContext<(t: Omit<T, "id">) => void>(() => undefined);
const ICON = { success: CheckCircle2, warning: ShieldAlert, danger: XCircle, info: Info };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const seq = useRef(0);
  const push = useCallback((t: Omit<T, "id">) => {
    const id = ++seq.current;
    setItems((x) => [...x.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), t.tone === "danger" ? 7000 : 4500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2">
        <AnimatePresence initial={false}>
          {items.map((t) => {
            const Icon = ICON[t.tone];
            return (
              <motion.div key={t.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 24 }}
                className="pointer-events-auto flex gap-3 rounded-lg border border-line bg-raised p-3 text-fg shadow-e3">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${TONE_CLASS[t.tone].text}`} aria-hidden />
                <div className="min-w-0 text-body-sm"><p className="font-semibold">{t.title}</p>{t.body && <p className="text-fg-2">{t.body}</p>}</div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const push = useContext(Ctx);
  return {
    ok: (title: string, body?: string) => push({ title, body, tone: "success" }),
    info: (title: string, body?: string) => push({ title, body, tone: "info" }),
    warn: (title: string, body?: string) => push({ title, body, tone: "warning" }),
    /** Explain a refusal in plain words; a 403 is the server enforcing a rule, not a crash. */
    error: (e: unknown, fallback = "Something went wrong") => {
      if (e instanceof ApiError) {
        const plain: Record<string, string> = { FORBIDDEN: "Not allowed for your role", SEGREGATION_OF_DUTIES: "Needs a different person",
          INVALID_STATE: "Not possible right now", VALIDATION_FAILED: "Check the details", DUPLICATE_FILE: "File already imported" };
        push({ title: plain[e.code] || fallback, body: e.message, tone: e.status === 403 ? "warning" : "danger" });
      } else push({ title: fallback, body: "The server could not be reached. Nothing was changed.", tone: "danger" });
    },
  };
}
