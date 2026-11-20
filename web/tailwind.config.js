/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#05070A", 900: "#0A0E14", 850: "#0E131B", 800: "#131A24", 700: "#1C2532", 600: "#2A3546", 500: "#3B4A5F" },
        paya: { 50: "#E9FFF4", 100: "#C8FCE3", 300: "#5EF0A9", 400: "#2EE58C", 500: "#12C972", 600: "#0A9F59", 700: "#087A46" },
        amber: { 400: "#FFC24B", 500: "#F5A524" },
        rose: { 400: "#FF6B81", 500: "#F43F5E" },
        sky: { 400: "#5CC8FF", 500: "#2AA9F2" },
        violet: { 400: "#A78BFA" },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(46,229,140,.35), 0 0 32px rgba(46,229,140,.25)",
        amber: "0 0 0 1px rgba(255,194,75,.45), 0 0 32px rgba(255,194,75,.25)",
        rose: "0 0 0 1px rgba(255,107,129,.5), 0 0 32px rgba(255,107,129,.3)",
      },
    },
  },
  plugins: [],
};
