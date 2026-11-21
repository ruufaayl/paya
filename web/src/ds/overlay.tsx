// Dialog and drawer built on Radix Dialog: focus trap, Escape to close, scroll lock, labelled for screen readers.
import * as D from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { dur, ease, spring } from "./motion";

interface OverlayProps { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }

export function Drawer({ open, onClose, title, description, children, footer, width = 560 }: OverlayProps) {
  return (
    <D.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <AnimatePresence>
        {open && (
          <D.Portal forceMount>
            <D.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-40 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: dur.base }} />
            </D.Overlay>
            <D.Content asChild forceMount aria-describedby={description ? undefined : undefined}>
              <motion.aside style={{ width: `min(${width}px, 100vw)` }}
                className="fixed inset-y-0 right-0 z-50 flex flex-col border-l border-line bg-surface text-fg shadow-e3 outline-none"
                initial={{ x: "100%" }} animate={{ x: 0, transition: spring.gentle }} exit={{ x: "100%", transition: { duration: dur.base, ease: ease.exit } }}>
                <header className="flex items-start gap-3 border-b border-line px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <D.Title className="truncate text-title-3 text-fg">{title}</D.Title>
                    {description ? <D.Description className="mt-0.5 text-body-sm text-fg-2">{description}</D.Description> : <D.Description className="sr-only">Details</D.Description>}
                  </div>
                  <D.Close aria-label="Close" className="grid h-9 w-9 place-items-center rounded-md text-fg-2 hover:bg-hover hover:text-fg"><X className="h-4 w-4" /></D.Close>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">{children}</div>
                {footer && <footer className="border-t border-line px-5 py-3">{footer}</footer>}
              </motion.aside>
            </D.Content>
          </D.Portal>
        )}
      </AnimatePresence>
    </D.Root>
  );
}

export function Dialog({ open, onClose, title, description, children, footer, width = 440 }: OverlayProps) {
  return (
    <D.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <AnimatePresence>
        {open && (
          <D.Portal forceMount>
            <D.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-40 bg-black/45" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </D.Overlay>
            <D.Content asChild forceMount>
              <motion.div style={{ width: `min(${width}px, calc(100vw - 32px))`, x: "-50%", y: "-50%" }}
                className="fixed left-1/2 top-1/2 z-50 rounded-xl border border-line bg-surface p-5 text-fg shadow-e3 outline-none"
                initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1, transition: { duration: dur.base, ease: ease.enter } }} exit={{ opacity: 0, scale: 0.98, transition: { duration: dur.fast } }}>
                <D.Title className="text-title-3 text-fg">{title}</D.Title>
                {description ? <D.Description className="mt-1 text-body-sm text-fg-2">{description}</D.Description> : <D.Description className="sr-only">Dialog</D.Description>}
                <div className="mt-4">{children}</div>
                {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
              </motion.div>
            </D.Content>
          </D.Portal>
        )}
      </AnimatePresence>
    </D.Root>
  );
}
