// Rupay motion tokens (mirrors the CSS variables in tokens.css). Motion explains change; it never decides it.
// Rule: an animation may only show a financial outcome that the server has already confirmed.
import type { Transition, Variants } from "framer-motion";

export const dur = { instant: 0.08, fast: 0.14, base: 0.22, slow: 0.32, deliberate: 0.48 };
export const ease = {
  standard: [0.2, 0, 0, 1] as const,
  enter: [0, 0, 0.2, 1] as const,
  exit: [0.4, 0, 1, 1] as const,
};
export const spring = {
  gentle: { type: "spring", stiffness: 260, damping: 30 } as Transition,
  snappy: { type: "spring", stiffness: 420, damping: 34 } as Transition,
  settle: { type: "spring", stiffness: 180, damping: 18 } as Transition, // confirmation marks only
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: dur.base, ease: ease.enter } },
  exit: { opacity: 0, y: -6, transition: { duration: dur.fast, ease: ease.exit } },
};
export const stagger = (step = 0.04): Variants => ({ show: { transition: { staggerChildren: step } } });
export const stepSlide = (dir: 1 | -1): Variants => ({
  hidden: { opacity: 0, x: 24 * dir },
  show: { opacity: 1, x: 0, transition: { duration: dur.slow, ease: ease.standard } },
  exit: { opacity: 0, x: -24 * dir, transition: { duration: dur.fast, ease: ease.exit } },
});
export const sheet: Variants = {
  hidden: { y: "100%" }, show: { y: 0, transition: spring.gentle }, exit: { y: "100%", transition: { duration: dur.base, ease: ease.exit } },
};
export const drawer: Variants = {
  hidden: { x: "100%" }, show: { x: 0, transition: spring.gentle }, exit: { x: "100%", transition: { duration: dur.base, ease: ease.exit } },
};
