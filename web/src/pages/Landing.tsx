// Entry page: two surfaces of one product, and the server address for demos on other devices.
import { motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { ArrowRight, MonitorDot, Smartphone } from "lucide-react";
import { Link } from "react-router-dom";
import { fadeUp, stagger } from "../ds/motion";
import { ServerStatus } from "../ds/server";
import { Badge, Card, Logo } from "../ds/ui";
import { apiBase } from "../lib/api";
import { useTheme } from "../lib/hooks";

export default function Landing() {
  useTheme("wallet");
  return (
    <div className="min-h-full bg-canvas">
      <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="mx-auto max-w-[1080px] px-5 py-8 md:py-14">
        <motion.header variants={fadeUp} className="flex items-center justify-between">
          <Logo size={30} />
          <Badge tone="info">Academic prototype · synthetic data</Badge>
        </motion.header>
        <motion.h1 variants={fadeUp} className="mt-12 max-w-3xl font-display text-[2.5rem] font-extrabold leading-[1.05] tracking-[-0.03em] text-fg md:text-[3.5rem]">
          Raast payments a cashier can trust. <span className="text-brand-accent">Payment, pakka.</span>
        </motion.h1>
        <motion.p variants={fadeUp} className="mt-4 max-w-2xl text-body text-fg-2 md:text-[17px] md:leading-7">
          Paya shows "Paid" only when a double-entry ledger and the Raast rail agree. Timeouts stay pending, retries never charge twice, and people decide what machines shouldn't.
        </motion.p>
        <motion.div variants={fadeUp} className="mt-10 grid gap-4 md:grid-cols-2">
          <Link to="/app" className="group">
            <Card className="h-full p-6 transition-shadow duration-base group-hover:shadow-e2">
              <Smartphone className="h-6 w-6 text-brand-accent" aria-hidden />
              <h2 className="mt-4 font-display text-title-2 text-fg">Paya Wallet</h2>
              <p className="mt-1 text-body-sm text-fg-2">Open a wallet with digital KYC, scan a Raast QR, pay, and get an authoritative receipt. Includes the merchant till.</p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-label text-brand-accent">Open on a phone <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
            </Card>
          </Link>
          <Link to="/control" className="group">
            <Card className="h-full bg-night p-6 text-night-fg transition-shadow duration-base group-hover:shadow-e2">
              <MonitorDot className="h-6 w-6 text-[#5CD6A4]" aria-hidden />
              <h2 className="mt-4 font-display text-title-2">Mission Control</h2>
              <p className="mt-1 text-body-sm text-night-fg/75">Operations console: transactions, topology, rail lab, cases with maker-checker, KYC review, reconciliation, AI triage and audit.</p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-label text-[#5CD6A4]">Open on a laptop <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
            </Card>
          </Link>
        </motion.div>
        <motion.div variants={fadeUp} className="mt-4 grid gap-4 md:grid-cols-[1fr_300px]">
          <ServerStatus />
          <PhoneQr />
        </motion.div>
        <motion.p variants={fadeUp} className="mt-8 text-caption text-fg-muted">FAST CS3017 Enterprise Systems semester project. Simulated Raast rail and identity registry; no real money, cards, CNICs or biometrics.</motion.p>
      </motion.div>
    </div>
  );
}

/** Scan with the iPhone camera: opens the wallet on this deployment, already pointed at this backend.
 *  Then Share -> Add to Home Screen inside that page, so the Home Screen app keeps the same address. */
function PhoneQr() {
  const link = `${window.location.origin}/app?api=${encodeURIComponent(apiBase())}`;
  const local = /localhost|127\.0\.0\.1/.test(window.location.origin + apiBase());
  return (
    <Card className="flex items-center gap-4 p-4">
      <div className="shrink-0 rounded-md bg-white p-1.5"><QRCodeSVG value={link} size={108} aria-label="QR code to open the wallet on a phone" /></div>
      <div className="min-w-0">
        <p className="text-label text-fg">Open on your phone</p>
        <p className="mt-1 text-caption text-fg-2">Scan with the camera, then Share → Add to Home Screen.</p>
        {local && <p className="mt-1 text-caption text-warning">This uses a localhost address; a phone needs the public (Vercel and tunnel) addresses.</p>}
      </div>
    </Card>
  );
}
