import { motion } from "framer-motion";
import jsQR from "jsqr";
import { Camera, ChevronRight, Store } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { call, pkr } from "../../lib/api";

interface OpenRequest { id: string; order_ref: string; amount: { minor: number }; merchant: { name: string; category: string }; expires_at: string }

/** Extract the payment-request id from a Paya QR payload (synthetic format; real Raast QR follows SBP specs). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parse(text: string): string | null {
  // A QR code is untrusted input. Only a well-formed payment-request UUID may ever reach the router
  // (compensating control for the open-redirect advisories in react-router 6.x; see threat model T-12).
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
  const [open, setOpen] = useState<OpenRequest[]>([]);

  useEffect(() => {
    const load = () => call<OpenRequest[]>(user, "/v1/payment-requests?status=OPEN").then((r) => setOpen(r.data)).catch(() => undefined);
    load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [user]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stop = false;
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setCamera("unsupported"); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (!video.current) return;
        video.current.srcObject = stream;
        video.current.setAttribute("playsinline", "true");
        await video.current.play();
        setCamera("on");
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
              const pr = code ? parse(code.data) : null;
              if (pr) { stop = true; nav(`/app/pay/${pr}`); return; }
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch { setCamera("denied"); }
    };
    start();
    return () => { stop = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [nav]);

  return (
    <div className="px-5 pb-8">
      <h2 className="mt-2 text-2xl font-bold">Scan a Raast QR</h2>
      <div className="relative mt-4 aspect-square overflow-hidden rounded-[28px] bg-ink-900 ring-1 ring-white/10">
        <video ref={video} className="h-full w-full object-cover" muted />
        <canvas ref={canvas} className="hidden" />
        <div className="pointer-events-none absolute inset-8 rounded-3xl border-2 border-paya-300/70">
          <motion.div className="absolute inset-x-4 h-0.5 rounded-full bg-paya-300 shadow-glow"
            animate={{ top: ["8%", "92%", "8%"] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }} />
        </div>
        {camera !== "on" && (
          <div className="absolute inset-0 grid place-items-center p-8 text-center text-sm text-slate-400">
            <div>
              <Camera className="mx-auto mb-3 text-slate-500" />
              {camera === "idle" && "Starting camera..."}
              {camera === "denied" && "Camera blocked. Allow camera access, or pick a till below."}
              {camera === "unsupported" && "Camera needs HTTPS. Pick a till below instead."}
            </div>
          </div>
        )}
      </div>

      <h3 className="mt-7 flex items-center gap-2 text-sm font-semibold text-slate-300"><Store size={15} /> Tills waiting for payment</h3>
      <div className="mt-3 space-y-2">
        {open.length === 0 && <p className="text-sm text-slate-500">No open requests. Ask a cashier to show a QR.</p>}
        {open.map((r) => (
          <motion.button key={r.id} whileTap={{ scale: 0.98 }} onClick={() => nav(`/app/pay/${r.id}`)}
            className="flex w-full items-center gap-3 rounded-2xl bg-ink-900/70 p-3 text-left ring-1 ring-white/[0.06]">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-paya-400/10 font-bold text-paya-300">{r.merchant.name[0]}</span>
            <span className="flex-1">
              <span className="block text-sm font-medium">{r.merchant.name}</span>
              <span className="block font-mono text-[10px] text-slate-500">{r.order_ref}</span>
            </span>
            <span className="num text-sm font-semibold">{pkr(r.amount.minor)}</span>
            <ChevronRight size={16} className="text-slate-500" />
          </motion.button>
        ))}
      </div>
    </div>
  );
}
