// Scan a synthetic Raast QR, or pick a nearby till. A QR is untrusted input: only a well-formed
// payment-request UUID can reach the router (compensating control for react-router advisories, T-12).
import { motion } from "framer-motion";
import jsQR from "jsqr";
import { ArrowLeft, Camera, ChevronRight, Store } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Card, EmptyState, IconButton, Money, Skeleton } from "../ds/ui";
import { useApi } from "../lib/hooks";

interface OpenRequest { id: string; order_ref: string; amount: { minor: number }; merchant: { name: string; category: string }; expires_at: string }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseQr(text: string): string | null {
  try {
    if (!text.startsWith("paya://pay?")) return null;
    const pr = new URL(text.replace(/^paya:\/\//, "https://paya.local/")).searchParams.get("pr");
    return pr && UUID_RE.test(pr) ? pr.toLowerCase() : null;
  } catch { return null; }
}

export default function Scan({ user }: { user: string }) {
  const nav = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [camera, setCamera] = useState<"idle" | "on" | "denied" | "unsupported">("idle");
  const [found, setFound] = useState(false);
  const open = useApi<OpenRequest[]>(user, "/v1/payment-requests?status=OPEN", { refetchInterval: 3000 });

  useEffect(() => {
    let stream: MediaStream | null = null, raf = 0, stop = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setCamera("unsupported"); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (!video.current) return;
        video.current.srcObject = stream; video.current.setAttribute("playsinline", "true");
        await video.current.play(); setCamera("on");
        const tick = () => {
          if (stop) return;
          const v = video.current, c = canvas.current;
          if (v && c && v.readyState === v.HAVE_ENOUGH_DATA) {
            c.width = v.videoWidth; c.height = v.videoHeight;
            const ctx = c.getContext("2d", { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(v, 0, 0, c.width, c.height);
              const img = ctx.getImageData(0, 0, c.width, c.height);
              const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
              const pr = code ? parseQr(code.data) : null;
              if (pr) { stop = true; setFound(true); setTimeout(() => nav(`/app/pay/${pr}`), 250); return; }
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch { setCamera("denied"); }
    })();
    return () => { stop = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [nav]);

  return (
    <div className="safe-top px-5 pb-8">
      <div className="flex items-center gap-2 pt-2">
        <IconButton label="Back" onClick={() => nav("/app")}><ArrowLeft className="h-5 w-5" /></IconButton>
        <h1 className="text-title-2 text-fg">Pay a shop</h1>
      </div>

      <div className="relative mt-4 aspect-square overflow-hidden rounded-xl bg-night">
        <video ref={video} className="h-full w-full object-cover" muted aria-label="Camera preview for scanning a QR code" />
        <canvas ref={canvas} className="hidden" />
        <div aria-hidden className={`pointer-events-none absolute inset-10 rounded-xl border-2 transition-colors duration-base ${found ? "border-brand" : "border-white/70"}`}>
          {camera === "on" && !found && <motion.div className="absolute inset-x-3 h-0.5 rounded-full bg-white/80" animate={{ top: ["6%", "94%", "6%"] }} transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }} />}
        </div>
        {camera !== "on" && (
          <div className="absolute inset-0 grid place-items-center p-8 text-center text-body-sm text-night-fg/80">
            <div><Camera className="mx-auto mb-3 h-6 w-6" aria-hidden />
              {camera === "idle" && "Starting the camera…"}
              {camera === "denied" && "Camera access is blocked. Allow it in your browser settings, or pick a till below."}
              {camera === "unsupported" && "The camera needs a secure (HTTPS) link. Pick a till below instead."}</div>
          </div>
        )}
        <p role="status" className="absolute inset-x-0 bottom-3 text-center text-caption text-night-fg/85">{found ? "QR recognised" : "Point at a Paya Raast QR"}</p>
      </div>

      <section id="tills" aria-labelledby="tills-h" className="mt-7">
        <div className="flex items-center justify-between">
          <h2 id="tills-h" className="flex items-center gap-2 text-title-3 text-fg"><Store className="h-4 w-4" aria-hidden /> Tills waiting for payment</h2>
          <Badge tone="info">Demo</Badge>
        </div>
        <p className="text-caption text-fg-2">Open requests from synthetic merchants, for when a camera scan isn't possible.</p>
        <div className="mt-3">
          {open.isLoading && <Card className="p-4"><Skeleton className="h-4 w-48" /></Card>}
          {open.data && open.data.length === 0 && <EmptyState icon={<Store className="h-5 w-5" />} title="No open tills" body="Ask a cashier to show a QR, or open the cashier till in another tab." />}
          {open.data && open.data.length > 0 && (
            <Card className="divide-y divide-line overflow-hidden">
              {open.data.map((r) => (
                <button key={r.id} onClick={() => nav(`/app/pay/${r.id}`)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-hover">
                  <span aria-hidden className="grid h-10 w-10 place-items-center rounded-md bg-night font-display font-bold text-night-fg">{r.merchant.name[0]}</span>
                  <span className="min-w-0 flex-1"><span className="block text-body font-medium text-fg">{r.merchant.name}</span><span className="ref block text-[11.5px] text-fg-muted">{r.order_ref}</span></span>
                  <Money minor={r.amount.minor} className="text-body font-semibold text-fg" />
                  <ChevronRight className="h-4 w-4 text-fg-muted" aria-hidden />
                </button>
              ))}
            </Card>
          )}
        </div>
      </section>
    </div>
  );
}
