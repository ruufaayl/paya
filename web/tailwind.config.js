/** @type {import('tailwindcss').Config} */
// Semantic colours map to CSS variables in src/ds/tokens.css, so one class works in both themes.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const status = (s) => ({ DEFAULT: v(s), soft: v(`${s}-soft`), line: v(`${s}-line`) });

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: v("canvas"), surface: v("surface"), raised: v("raised"), sunken: v("sunken"), hover: v("hover"),
        line: { DEFAULT: v("line"), strong: v("line-strong"), control: v("control-line") },
        fg: { DEFAULT: v("fg"), 2: v("fg-2"), muted: v("fg-muted"), disabled: v("fg-disabled") },
        brand: { DEFAULT: v("brand"), strong: v("brand-strong"), soft: v("brand-soft"), fg: v("brand-fg"), accent: v("brand-accent") },
        night: { DEFAULT: v("night"), fg: v("night-fg") },
        focus: v("focus"),
        success: status("success"), processing: status("processing"), review: status("review"),
        warning: status("warning"), danger: status("danger"), info: status("info"), neutral: status("neutral"),
        // Legacy palette (Paya 1.x). Kept so older screens keep working; new code uses semantic tokens.
        ink: { 950: "#05070A", 900: "#0A0E14", 850: "#0E131B", 800: "#131A24", 700: "#1C2532", 600: "#2A3546", 500: "#3B4A5F" },
        paya: { 50: "#E9FFF4", 100: "#C8FCE3", 200: "#A8F5CF", 300: "#5EF0A9", 400: "#2EE58C", 500: "#12C972", 600: "#0A9F59", 700: "#087A46" },
      },
      fontFamily: {
        display: ["var(--font-display)"], sans: ["var(--font-text)"], mono: ["var(--font-mono)"],
      },
      fontSize: {
        // [size, { lineHeight, letterSpacing, fontWeight }]
        "display-xl": ["2.5rem", { lineHeight: "2.75rem", letterSpacing: "-0.025em", fontWeight: "800" }],
        display: ["2rem", { lineHeight: "2.375rem", letterSpacing: "-0.022em", fontWeight: "800" }],
        "title-1": ["1.5rem", { lineHeight: "1.875rem", letterSpacing: "-0.018em", fontWeight: "700" }],
        "title-2": ["1.25rem", { lineHeight: "1.625rem", letterSpacing: "-0.012em", fontWeight: "700" }],
        "title-3": ["1.0625rem", { lineHeight: "1.5rem", letterSpacing: "-0.008em", fontWeight: "600" }],
        body: ["0.9375rem", { lineHeight: "1.4375rem" }],
        "body-sm": ["0.875rem", { lineHeight: "1.3125rem" }],
        label: ["0.8125rem", { lineHeight: "1.125rem", fontWeight: "500" }],
        caption: ["0.75rem", { lineHeight: "1rem" }],
        overline: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.06em", fontWeight: "600" }],
        "amount-xl": ["3rem", { lineHeight: "3.25rem", letterSpacing: "-0.03em", fontWeight: "800" }],
        amount: ["2rem", { lineHeight: "2.25rem", letterSpacing: "-0.02em", fontWeight: "750" }],
      },
      borderRadius: { xs: "var(--r-xs)", sm: "var(--r-sm)", md: "var(--r-md)", lg: "var(--r-lg)", xl: "var(--r-xl)", "2xl": "var(--r-2xl)" },
      boxShadow: { e1: "var(--shadow-1)", e2: "var(--shadow-2)", e3: "var(--shadow-3)",
        glow: "0 0 0 1px rgba(46,229,140,.35), 0 0 32px rgba(46,229,140,.25)" },
      transitionTimingFunction: { standard: "var(--ease-standard)", enter: "var(--ease-enter)", exit: "var(--ease-exit)" },
      transitionDuration: { fast: "140ms", base: "220ms", slow: "320ms" },
      screens: { xs: "360px", "3xl": "1680px" },
      keyframes: {
        shimmer: { "0%": { backgroundPosition: "-400px 0" }, "100%": { backgroundPosition: "400px 0" } },
        "pulse-dot": { "0%,100%": { opacity: "1" }, "50%": { opacity: ".35" } },
      },
      animation: { shimmer: "shimmer 1.4s linear infinite", "pulse-dot": "pulse-dot 1.6s ease-in-out infinite" },
    },
  },
  plugins: [],
};
