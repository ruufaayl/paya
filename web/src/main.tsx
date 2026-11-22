import { adoptApiFromUrl } from "./lib/api";
import "@fontsource-variable/inter";
import "@fontsource-variable/manrope";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "./ds/toast";
import "./index.css";

// One cache for every screen: requests are shared and de-duplicated instead of each component polling alone.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1500, retry: (n, e: any) => n < 2 && !(e?.status >= 400 && e?.status < 500), refetchOnWindowFocus: true },
    mutations: { retry: false }, // a consequential action is never retried silently
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ToastProvider>
            <App />
          </ToastProvider>
        </BrowserRouter>
      </MotionConfig>
    </QueryClientProvider>
  </React.StrictMode>,
);

adoptApiFromUrl();   // ?api=https://backend on any link points this device at that backend

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}

// iOS Safari ignores user-scalable=no for pinch, so block the pinch gesture itself outside Mission Control
// (the console keeps pinch for the topology map). Double-tap zoom is off via touch-action: manipulation.
const blockPinch = (e: Event) => { if (!location.pathname.startsWith("/control")) e.preventDefault(); };
["gesturestart", "gesturechange"].forEach((t) => document.addEventListener(t, blockPinch, { passive: false }));
document.addEventListener("touchmove", (e) => { if ((e as TouchEvent).touches.length > 1) blockPinch(e); }, { passive: false });
