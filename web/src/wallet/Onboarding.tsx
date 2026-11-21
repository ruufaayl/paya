// Open a Paya wallet: consent -> details -> synthetic specimen ID -> head-turn liveness -> decision.
// Photos are sent once for checking and are never stored, on the phone or on the server.
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Camera, Check, Clock, Fingerprint, IdCard, Lock, MapPin, RefreshCw, ScanFace, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Input, Logo, Spinner } from "../ds/ui";
import { ApiError, login, onboard } from "../lib/api";

type Step = "intro" | "details" | "card" | "liveness" | "result";
interface Specimen { specimen_id: string; full_name: string; date_of_birth: string; expires_on: string; qr_png: string }
interface Result { outcome: "APPROVED" | "REFERRED" | "RETRY"; message?: string; reason?: string; username?: string; attempts_left?: number }

const DOC_PROBLEMS: Record<string, string> = {
  BLURRY: "The photo is blurry. Hold the phone still.", TOO_DARK: "It's too dark. Find more light.", TOO_BRIGHT: "It's too bright.",
  GLARE: "There's glare on the card. Tilt it away from the light.", CODE_NOT_FOUND: "We couldn't read the code on the card.",
  NOT_A_PAYA_SPECIMEN: "That isn't a Paya specimen card.", NAME_DOES_NOT_MATCH: "The name on the card doesn't match the name you entered.",
  DATE_OF_BIRTH_DOES_NOT_MATCH: "The date of birth on the card doesn't match.", DOCUMENT_EXPIRED: "This card has expired.",
  NO_FACE_ON_DOCUMENT: "We couldn't find a face in the card photo. Retake your photo with your face centred.",
  IMAGE_TOO_LARGE: "The photo is too large.", IMAGE_UNREADABLE: "We couldn't open that photo.",
};
const LIVENESS_TIPS: Record<string, string> = {
  TURN_FURTHER_LEFT: "Turn your head a little further to your left.", TURN_FURTHER_RIGHT: "Turn your head a little further to your right.",
  LOOK_STRAIGHT: "Look straight at the camera for the first photo.", NO_FACE_CENTER: "We couldn't see your face. Find better light.",
  NO_FACE_LEFT: "We lost your face while you turned. Turn more slowly.", NO_FACE_RIGHT: "We lost your face while you turned. Turn more slowly.",
  REPEATED_FRAME: "The camera sent the same picture twice. Try again.", STEPS_OUT_OF_ORDER: "Follow the arrows in order.",
};
const STEP_TEXT: Record<string, { text: string; arrow?: "left" | "right" }> = {
  CENTER: { text: "Look straight at the camera" }, LEFT: { text: "Slowly turn your head to your left", arrow: "left" },
  RIGHT: { text: "Slowly turn your head to your right", arrow: "right" },
};

export default function Onboarding({ onDone }: { onDone: (username: string) => void }) {
  const nav = useNavigate();
  const [step, setStep] = useState<Step>("intro");
  const [token, setToken] = useState<string | null>(null);
  const [ref, setRef] = useState("");
  const [form, setForm] = useState({ full_name: "", date_of_birth: "", mobile: "", username: "", password: "" });
  const [doc, setDoc] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const order: Step[] = ["intro", "details", "card", "liveness", "result"];

  return (
    <div className="min-h-full bg-canvas">
      <div className="safe-top mx-auto flex min-h-full max-w-md flex-col px-5 pb-8">
        <div className="flex items-center justify-between pt-2">
          <button onClick={() => (step === "intro" ? nav("/app") : setStep(order[Math.max(0, order.indexOf(step) - 1)]))}
            className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-fg" aria-label="Back"
            disabled={step === "result"}><ArrowLeft size={16} /></button>
          <Logo size={24} />
          <span className="w-9" />
        </div>
        <div className="mt-4 flex gap-1.5">
          {order.slice(1).map((s, i) => (
            <span key={s} className={`h-1 flex-1 rounded-full transition-colors ${order.indexOf(step) > i ? "bg-brand" : "bg-line"}`} />
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.22 }} className="flex flex-1 flex-col">
            {step === "intro" && <Intro onNext={() => setStep("details")} />}
            {step === "details" && <Details form={form} setForm={setForm} onStarted={(t, r) => { setToken(t); setRef(r); setStep("card"); }} />}
            {step === "card" && token && <CardStep token={token} form={form} onAccepted={(img) => { setDoc(img); setStep("liveness"); }}
              onReferred={(r) => { setResult(r); setStep("result"); }} />}
            {step === "liveness" && token && doc && <Liveness token={token} doc={doc} onResult={(r) => { setResult(r); setStep("result"); }} />}
            {step === "result" && result && <ResultStep result={result} appRef={ref} token={token} form={form} onDone={onDone} onRetake={() => setStep("card")} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 0. what to expect + consent
function Intro({ onNext }: { onNext: () => void }) {
  const [terms, setTerms] = useState(false);
  const [bio, setBio] = useState(false);
  const row = (Icon: any, title: string, text: string) => (
    <div className="flex gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-accent"><Icon size={17} /></span>
      <div><p className="text-sm font-semibold">{title}</p><p className="text-xs leading-relaxed text-fg-2">{text}</p></div>
    </div>
  );
  return (
    <>
      <h1 className="mt-8 font-display text-display text-fg">Open a Paya wallet<br /><span className="text-brand-accent">in about two minutes.</span></h1>
      <div className="mt-6 space-y-4 rounded-lg border border-line bg-surface p-4 shadow-e1">
        {row(IdCard, "A specimen ID card", "This prototype never asks for a real CNIC. We make you a synthetic SPECIMEN card instead.")}
        {row(ScanFace, "A quick selfie check", "Look at the camera, then turn left and right. This is a basic, demo-grade liveness check, not a certified anti-spoofing system.")}
        {row(Lock, "Photos aren't stored", "Checked once in memory, then discarded; only scores and results are kept. An automated test (K9) checks the database never holds image data.")}
        {row(MapPin, "Your rough location", "Recorded to about 1 km, as onboarding rules require. Not tracked afterwards.")}
      </div>
      <div className="mt-5 space-y-3">
        <Tick on={terms} set={setTerms}>I agree to the Paya prototype terms. I understand this is a demo with synthetic data and no real money.</Tick>
        <Tick on={bio} set={setBio}>I agree to Paya processing my photos to check my identity. They will not be stored.</Tick>
      </div>
      <div className="mt-auto pt-6"><Button size="lg" className="w-full" disabled={!terms || !bio} onClick={onNext}>Let's go <ArrowRight size={16} /></Button></div>
    </>
  );
}

function Tick({ on, set, children }: { on: boolean; set: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <button onClick={() => set(!on)} className="flex w-full items-start gap-3 text-left">
      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition ${on ? "bg-brand border-brand text-brand-fg" : "border-line-control"}`}>{on && <Check size={14} strokeWidth={3} />}</span>
      <span className="text-xs leading-relaxed text-fg-2">{children}</span>
    </button>
  );
}

// ------------------------------------------------------------------ 1. details
function Details({ form, setForm, onStarted }: { form: any; setForm: (f: any) => void; onStarted: (token: string, ref: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const field = (k: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Input label={label} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} {...props} />
  );
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await onboard<{ onboarding_token: string; ref: string }>("/v1/onboarding/start", null,
        { ...form, username: form.username.trim().toLowerCase(), accept_terms: true, biometric_consent: true });
      onStarted(r.onboarding_token, r.ref);
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Cannot reach the Paya server."); } finally { setBusy(false); }
  };
  return (
    <>
      <h2 className="mt-8 font-display text-title-1 text-fg">About you</h2>
      <p className="mt-1 text-sm text-fg-2">Use a made-up person. Everything here is synthetic.</p>
      <div className="mt-5 space-y-3">
        {field("full_name", "Full name", { placeholder: "Hira Qureshi", autoComplete: "off" })}
        {field("date_of_birth", "Date of birth", { type: "date" })}
        {field("mobile", "Mobile", { placeholder: "0300 1234567", inputMode: "tel" })}
        <div className="grid grid-cols-2 gap-3">
          {field("username", "Username", { placeholder: "hira.q", autoCapitalize: "none" })}
          {field("password", "Password", { type: "password", placeholder: "10+ characters" })}
        </div>
      </div>
      {err && <div className="mt-4"><Alert tone="danger" title="Please check">{err}</Alert></div>}
      <div className="mt-auto pt-6">
        <Button size="lg" className="w-full" disabled={busy || !form.full_name || !form.date_of_birth || !form.mobile || !form.username || form.password.length < 10} onClick={submit}>
          {busy ? <Spinner /> : <>Continue <ArrowRight size={16} /></>}
        </Button>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ camera
function useCamera(facing: "user" | "environment", active: boolean) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"idle" | "on" | "denied" | "unsupported">("idle");
  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setState("unsupported"); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
        if (!video.current) return;
        video.current.srcObject = stream;
        video.current.setAttribute("playsinline", "true");
        await video.current.play();
        setState("on");
      } catch { setState("denied"); }
    })();
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [facing, active]);
  /** Grab an UNMIRRORED frame (what the camera really sees), scaled down, as JPEG. */
  const grab = (maxW = 720): string | null => {
    const v = video.current;
    if (!v || !v.videoWidth) return null;
    const scale = Math.min(1, maxW / v.videoWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.88);
  };
  return { video, state, grab };
}

const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

/** Draw the specimen card on the device. Paya's own design - it does not imitate any government card. */
async function composeCard(spec: Specimen, photo: string): Promise<string> {
  const W = 1012, H = 638;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, "#F3FBF7"); bg.addColorStop(1, "#E4F3EC");
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = "#087A46"; g.fillRect(0, 0, W, 96);
  g.fillStyle = "#fff"; g.font = "800 52px Inter, system-ui, sans-serif"; g.fillText("paya", 32, 66);
  g.font = "600 22px Inter, system-ui, sans-serif"; g.fillText("SYNTHETIC TEST IDENTITY · NOT AN IDENTITY DOCUMENT", 196, 58);
  const img = await loadImg(photo);
  const pw = 260, ph = 330, x0 = 36, y0 = 128;
  const s = Math.max(pw / img.width, ph / img.height);
  const sw = pw / s, sh = ph / s;
  g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x0, y0, pw, ph);
  g.strokeStyle = "#087A46"; g.lineWidth = 4; g.strokeRect(x0, y0, pw, ph);
  const fields: [string, string][] = [["NAME", spec.full_name], ["DATE OF BIRTH", spec.date_of_birth], ["SPECIMEN NO.", spec.specimen_id], ["VALID UNTIL", spec.expires_on]];
  let y = 150;
  for (const [label, value] of fields) {
    g.fillStyle = "#5B6B63"; g.font = "600 18px Inter, system-ui, sans-serif"; g.fillText(label, 330, y);
    g.fillStyle = "#10201A"; g.font = "700 32px Inter, system-ui, sans-serif"; g.fillText(value, 330, y + 38);
    y += 84;
  }
  g.save(); g.translate(W / 2, H / 2 + 60); g.rotate(-0.24);
  g.fillStyle = "rgba(230,40,60,0.28)"; g.font = "900 150px Inter, system-ui, sans-serif"; g.textAlign = "center"; g.fillText("SPECIMEN", 0, 0);
  g.restore();
  const qr = await loadImg(spec.qr_png);
  g.fillStyle = "#fff"; g.fillRect(W - 304, 140, 280, 280);
  g.drawImage(qr, W - 300, 144, 272, 272);
  g.fillStyle = "#5B6B63"; g.font = "500 18px Inter, system-ui, sans-serif"; g.fillText("Prototype for FAST CS3017 · synthetic data only", 36, H - 28);
  return c.toDataURL("image/jpeg", 0.92);
}

// ------------------------------------------------------------------ 2. specimen card + document check
function CardStep({ token, form, onAccepted, onReferred }: { token: string; form: any; onAccepted: (img: string) => void; onReferred: (r: Result) => void }) {
  const [spec, setSpec] = useState<Specimen | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const cam = useCamera("user", !card);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => { onboard<Specimen>("/v1/onboarding/specimen", token).then(setSpec).catch((e) => setErr(e.message)); }, [token]);

  const make = async (photo: string | null) => {
    if (!photo || !spec) return;
    setCard(await composeCard(spec, photo)); setProblems([]);
  };
  const fromFile = (f?: File) => { if (!f) return; const r = new FileReader(); r.onload = () => make(String(r.result)); r.readAsDataURL(f); };
  const check = async () => {
    if (!card) return;
    setBusy(true); setErr(null);
    try {
      const r = await onboard<{ accepted: boolean; problems: string[]; message?: string; state?: string }>("/v1/onboarding/document", token, { image: card });
      if (r.accepted) onAccepted(card);
      else if (r.state === "REFERRED") onReferred({ outcome: "REFERRED", message: r.message });
      else setProblems(r.problems);
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Upload failed"); } finally { setBusy(false); }
  };

  return (
    <>
      <h2 className="mt-8 font-display text-title-1 text-fg">Your specimen ID</h2>
      <p className="mt-1 text-sm text-fg-2">{card ? "Here's your synthetic card. We'll check it like a real one." : "Take a photo of your face for the card. Centre it in the frame."}</p>
      {!card ? (
        <div className="relative mt-5 aspect-[4/5] overflow-hidden rounded-[28px] bg-night">
          <video ref={cam.video} className="h-full w-full -scale-x-100 object-cover" muted />
          <div className="pointer-events-none absolute inset-x-[18%] top-[12%] bottom-[18%] rounded-[50%] border-2 border-dashed border-white/70" />
          {cam.state !== "on" && <CamMessage state={cam.state} />}
        </div>
      ) : (
        <motion.img initial={{ rotateY: 90, opacity: 0 }} animate={{ rotateY: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 120, damping: 16 }}
          src={card} alt="Your synthetic specimen ID card" className="mt-5 w-full rounded-2xl shadow-e3 border border-line" />
      )}
      {spec && <p className="mt-3 text-center font-mono text-[11px] text-fg-muted">{spec.specimen_id} · issued by the simulated registry</p>}
      {problems.length > 0 && (
        <div className="mt-4 space-y-1 rounded-md border border-warning-line bg-warning-soft p-3 text-sm text-warning">
          {problems.map((p) => <p key={p}>{DOC_PROBLEMS[p] || p}</p>)}
        </div>
      )}
      {err && <div className="mt-4"><Alert tone="danger" title="Please check">{err}</Alert></div>}
      <input ref={file} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => fromFile(e.target.files?.[0])} />
      <div className="mt-auto space-y-2 pt-6">
        {!card ? (
          <>
            <Button size="lg" className="w-full" disabled={cam.state !== "on" || !spec} onClick={() => make(cam.grab(900))}><Camera size={16} /> Take photo</Button>
            <Button variant="secondary" size="lg" className="w-full" disabled={!spec} onClick={() => file.current?.click()}>Use a photo instead</Button>
          </>
        ) : (
          <>
            <Button size="lg" className="w-full" disabled={busy} onClick={check}>{busy ? <><Spinner /> Checking the card...</> : <>Check my card <ShieldCheck size={16} /></>}</Button>
            <Button variant="secondary" size="lg" className="w-full" onClick={() => setCard(null)}><RefreshCw size={15} /> Retake photo</Button>
          </>
        )}
        <p className="text-center text-[11px] text-fg-muted">For {form.full_name}. The card exists only on this phone.</p>
      </div>
    </>
  );
}

function CamMessage({ state }: { state: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center p-8 text-center text-sm text-fg-2">
      <div>
        <Camera className="mx-auto mb-3 text-fg-muted" />
        {state === "idle" && "Starting camera..."}
        {state === "denied" && "Camera blocked. Allow camera access in your browser settings."}
        {state === "unsupported" && "The camera needs HTTPS. Open Paya from its secure link."}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 3. liveness
function Liveness({ token, doc, onResult }: { token: string; doc: string; onResult: (r: Result) => void }) {
  const cam = useCamera("user", true);
  const [phase, setPhase] = useState<"ready" | "capturing" | "checking">("ready");
  const [current, setCurrent] = useState<string | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const geo = useRef<GeolocationPosition | null>(null);

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition((p) => { geo.current = p; }, () => undefined, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  }, []);

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const run = async () => {
    setErr(null); setTip(null); setPhase("capturing");
    try {
      const ch = await onboard<{ nonce: string; steps: string[] }>("/v1/onboarding/liveness/challenge", token);
      const frames: { step: string; image: string }[] = [];
      for (const st of ch.steps) {
        setCurrent(st);
        await wait(st === "CENTER" ? 1600 : 2300);
        const img = cam.grab(640);
        if (!img) throw new Error("camera stopped");
        frames.push({ step: st, image: img });
      }
      setCurrent(null); setPhase("checking");
      const g = geo.current;
      const r = await onboard<Result>("/v1/onboarding/verify", token, {
        nonce: ch.nonce, document_image: doc, frames,
        geolocation: g ? { lat: g.coords.latitude, lon: g.coords.longitude, accuracy: g.coords.accuracy } : null,
      });
      if (r.outcome === "RETRY") { setTip(LIVENESS_TIPS[r.reason || ""] || "Let's try that again."); setPhase("ready"); }
      else onResult(r);
    } catch (e) {
      const m = e instanceof ApiError ? e.message : "";
      setErr(m.startsWith("image rejected") ? "The camera picture couldn't be read. Check the camera is working and try again."
        : m || "Something went wrong. Try again.");
      setPhase("ready"); setCurrent(null);
    }
  };

  const s = current ? STEP_TEXT[current] : null;
  return (
    <>
      <h2 className="mt-8 font-display text-title-1 text-fg">Show us it's really you</h2>
      <p className="mt-1 text-sm text-fg-2">Three quick photos. Follow the arrows.</p>
      <div className="relative mx-auto mt-5 aspect-[3/4] w-full overflow-hidden rounded-[32px] bg-night">
        <video ref={cam.video} className="h-full w-full -scale-x-100 object-cover" muted />
        <motion.div className="pointer-events-none absolute inset-x-[16%] top-[10%] bottom-[16%] rounded-[50%] border-[3px]"
          animate={{ borderColor: phase === "capturing" ? "rgba(94,240,169,0.95)" : "rgba(255,255,255,0.55)" }} />
        <AnimatePresence>
          {s && (
            <motion.div key={current} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="absolute inset-x-4 bottom-4 flex items-center justify-center gap-3 rounded-2xl bg-black/60 px-4 py-3 text-sm font-semibold backdrop-blur">
              {s.arrow === "left" && <motion.span animate={{ x: [0, -8, 0] }} transition={{ repeat: Infinity, duration: 0.9 }}><ArrowLeft size={22} className="text-brand-accent" /></motion.span>}
              {s.text}
              {s.arrow === "right" && <motion.span animate={{ x: [0, 8, 0] }} transition={{ repeat: Infinity, duration: 0.9 }}><ArrowRight size={22} className="text-brand-accent" /></motion.span>}
            </motion.div>
          )}
        </AnimatePresence>
        {phase === "checking" && (
          <div className="absolute inset-0 grid place-items-center bg-night/80 backdrop-blur-sm">
            <div className="text-center">
              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2.4, ease: "linear" }} className="mx-auto grid h-16 w-16 place-items-center rounded-full ring-2 ring-brand/50">
                <Fingerprint className="text-brand-accent" />
              </motion.div>
              <p className="mt-4 text-sm font-semibold">Checking your identity</p>
              <p className="mt-1 text-xs text-fg-2">Liveness · face match · registry · screening</p>
            </div>
          </div>
        )}
        {cam.state !== "on" && <CamMessage state={cam.state} />}
      </div>
      {tip && <p className="mt-4 rounded-md border border-warning-line bg-warning-soft p-3 text-sm text-warning">{tip}</p>}
      {err && <div className="mt-4"><Alert tone="danger" title="Please check">{err}</Alert></div>}
      <div className="mt-auto pt-6">
        <Button size="lg" className="w-full" disabled={cam.state !== "on" || phase !== "ready"} onClick={run}>
          {phase === "ready" ? <><ScanFace size={16} /> {tip ? "Try again" : "Start"}</> : <><Spinner /> {phase === "checking" ? "Checking..." : "Hold still..."}</>}
        </Button>
        <p className="mt-2 text-center text-[11px] text-fg-muted">Checked once in memory, not stored. Demo-grade liveness.</p>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ 4. result
function ResultStep({ result, appRef, token, form, onDone, onRetake }: { result: Result; appRef: string; token: string | null; form: any; onDone: (u: string) => void; onRetake: () => void }) {
  const [state, setState] = useState(result.outcome === "APPROVED" ? "APPROVED" : "REFERRED");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (state !== "REFERRED" || !token) return;
    const t = setInterval(() => onboard<{ state: string }>("/v1/onboarding/status", token, undefined, "GET")
      .then((s) => setState(s.state)).catch(() => undefined), 4000);
    return () => clearInterval(t);
  }, [state, token]);
  const enter = async () => {
    setBusy(true); setErr(null);
    const u = form.username.trim().toLowerCase();
    try { await login(u, form.password); onDone(u); } catch (e) { setErr(e instanceof ApiError ? e.message : "Sign-in failed"); } finally { setBusy(false); }
  };

  if (state === "APPROVED") return (
    <div className="flex flex-1 flex-col items-center text-center">
      <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 160, damping: 12 }}
        className="relative mt-16 grid h-28 w-28 place-items-center rounded-full border-4 border-success-line bg-success-soft text-success">
        <Check size={56} strokeWidth={3} />
        {[...Array(10)].map((_, i) => (
          <motion.span key={i} className="absolute h-2 w-2 rounded-full bg-brand"
            initial={{ x: 0, y: 0, opacity: 1 }} animate={{ x: Math.cos(i * 0.63) * 110, y: Math.sin(i * 0.63) * 110, opacity: 0 }} transition={{ duration: 1.1, delay: 0.2 }} />
        ))}
      </motion.div>
      <h2 className="mt-8 text-3xl font-extrabold">Your wallet is open</h2>
      <p className="mt-2 max-w-xs text-sm text-fg-2">Tier 1 wallet for {form.full_name}. Demo mode adds Rs 5,000 of synthetic credit so you can try a payment.</p>
      <p className="mt-3 font-mono text-[11px] text-fg-muted">{appRef}</p>
      {err && <p className="mt-4 text-sm text-danger">{err}</p>}
      <div className="mt-auto w-full pt-6"><Button size="lg" className="w-full" disabled={busy} onClick={enter}>{busy ? <Spinner /> : <><Sparkles size={16} /> Start using Paya</>}</Button></div>
    </div>
  );
  if (state === "REJECTED") return (
    <div className="mt-16 text-center">
      <h2 className="font-display text-title-1 text-fg">We couldn't open a wallet</h2>
      <p className="mt-2 text-sm text-fg-2">You can contact support for more information. Reference {appRef}.</p>
    </div>
  );
  return (
    <div className="flex flex-1 flex-col items-center text-center">
      <motion.div animate={{ scale: [1, 1.06, 1] }} transition={{ repeat: Infinity, duration: 2.2 }}
        className="mt-16 grid h-24 w-24 place-items-center rounded-full border border-review-line bg-review-soft text-review"><Clock size={40} /></motion.div>
      <h2 className="mt-8 font-display text-title-1 text-fg">{state === "MORE_INFO" ? "We need a clearer photo" : "A person is checking a few details"}</h2>
      <p className="mt-2 max-w-xs text-sm text-fg-2">{state === "MORE_INFO" ? "Our team asked for a new photo of your ID card. Start again from your card." : (result.message || "We'll update this screen as soon as they decide.")}</p>
      <p className="mt-3 font-mono text-[11px] text-fg-muted">{appRef}</p>
      {state === "MORE_INFO"
        ? <div className="mt-auto w-full pt-6"><Button size="lg" className="w-full" onClick={onRetake}><IdCard size={16} /> Retake my card</Button></div>
        : <p className="mt-6 flex items-center gap-2 text-xs text-fg-muted"><Spinner className="h-3 w-3" /> Waiting for a decision</p>}
    </div>
  );
}
