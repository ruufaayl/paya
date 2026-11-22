// Automated rehearsal of the Paya 2.0 technical demo (docs/demo/demo-script.md).
// Two emulated iPhones (Ayesha's till, a customer wallet) and Mission Control, driven through every scene in
// order, against the real backend. Each claim the presenter makes is asserted against the API, each scene is
// timed, and a screenshot is saved per scene.
//
//   make demo-reset                      # fresh synthetic data (API on :8000), face models installed (make models)
//   cd web && npm run build && npx vite preview --port 4173
//   make rehearse                        # or: WEB=http://localhost:5173 node docs/architecture/tools/demo_rehearsal.cjs
//
// Writes evidence/demo/rehearsal-<date>.md and evidence/demo/scene-*.png
const { chromium, devices } = require("playwright");
const fs = require("fs");
const path = require("path");

const WEB = process.env.WEB || "http://localhost:4173";
const API = process.env.API || "http://localhost:8000";
const OUT = path.resolve(__dirname, "../../../evidence/demo");
fs.mkdirSync(OUT, { recursive: true });
const scenes = [];
const pageErrors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tokens = {};
async function api(p, { as = "taha.audit", method = "GET", body, headers = {} } = {}) {
  if (!tokens[as]) tokens[as] = (await (await fetch(`${API}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: as, password: "paya-demo-2026" }) })).json()).access_token;
  const r = await fetch(`${API}${p}`, { method, headers: { authorization: `Bearer ${tokens[as]}`, "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const status = async (ref) => (await api(`/v1/transactions/${ref}`)).data.status;
async function waitFor(fn, ms = 20000, step = 400) { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(step); } return null; }

async function scene(name, shot, fn) {
  const t = Date.now();
  const checks = [];
  const check = (label, ok, note = "") => { checks.push({ label, ok: !!ok, note }); if (!ok) console.log(`  FAIL: ${label} ${note}`); };
  try { await fn(check); } catch (e) { checks.push({ label: `error: ${e.message.split("\n")[0]}`, ok: false }); }
  try { await shot(); } catch { /* screenshot best-effort */ }
  const s = { name, seconds: (Date.now() - t) / 1000, checks };
  scenes.push(s);
  console.log(`${checks.every((c) => c.ok) ? "PASS" : "FAIL"}  ${name}  (${s.seconds.toFixed(1)} s)`);
}

// Fake camera for the onboarding scene: a DRAWN synthetic face (no real person) that turns when asked.
const FAKE_CAMERA = () => {
  window.__turn = 0;
  const c = document.createElement("canvas"); c.width = 640; c.height = 480;
  const g = c.getContext("2d"); let t = 0;
  const ell = (x, y, rx, ry, col, fill = true, a = 0, b = Math.PI * 2) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, a, b); if (fill) { g.fillStyle = col; g.fill(); } else { g.strokeStyle = col; g.lineWidth = 5; g.stroke(); } };
  const draw = () => {
    t++; const turn = window.__turn;
    g.filter = "none"; g.fillStyle = "rgb(220,210,200)"; g.fillRect(0, 0, 640, 480);
    g.save(); g.translate(120, 40); g.filter = "blur(2px)"; ell(200, 210, 110, 140, "rgb(215,170,140)");
    for (const sd of [-1, 1]) { const ex = 200 + sd * 45 + turn * 12; ell(ex, 180, 22, 12, "#fff"); ell(ex + turn * 6, 180, 9, 9, "rgb(30,30,40)"); g.strokeStyle = "rgb(70,50,50)"; g.lineWidth = 5; g.beginPath(); g.moveTo(ex - 25, 155); g.lineTo(ex + 25, 152); g.stroke(); }
    const nx = 200 + turn * 45; g.strokeStyle = "rgb(170,120,100)"; g.lineWidth = 3; g.beginPath(); g.moveTo(nx, 190); g.lineTo(nx - 15, 255); g.lineTo(nx + 15, 255); g.closePath(); g.stroke();
    ell(200 + turn * 22, 295, 40, 15, "rgb(160,60,60)", false, 0, Math.PI); g.restore();
    g.fillStyle = `rgba(0,0,0,${0.02 + (t % 7) / 400})`; g.fillRect(0, 470, 640, 10); requestAnimationFrame(draw);
  };
  draw(); const stream = c.captureStream(20); navigator.mediaDevices.getUserMedia = async () => stream.clone();
};

(async () => {
  const browser = await chromium.launch();
  const watch = (p, n) => p.on("pageerror", (e) => pageErrors.push(`${n}: ${e.message}`));
  const mc = await (await browser.newContext({ viewport: { width: 1600, height: 940 } })).newPage(); watch(mc, "control");
  const till = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage(); watch(till, "till");
  const wctx = await browser.newContext({ ...devices["iPhone 13"], permissions: ["geolocation", "camera"], geolocation: { latitude: 31.5204, longitude: 74.3587, accuracy: 40 } });
  await wctx.addInitScript(FAKE_CAMERA);
  const phone = await wctx.newPage(); watch(phone, "wallet");
  await api("/v1/chaos/rail", { as: "admin", method: "POST", body: { mode: "NORMAL" } });

  const actAs = async (name) => {
    for (let i = 0; i < 4 && await mc.getByRole("dialog").count(); i++) { await mc.keyboard.press("Escape"); await sleep(450); }
    await mc.locator('button[aria-haspopup="menu"]').click(); await mc.getByRole("menuitemradio", { name: new RegExp(name) }).click(); await sleep(900); };
  const sale = async (amount) => {
    if (await till.getByRole("button", { name: "New sale" }).isVisible().catch(() => false)) await till.getByRole("button", { name: "New sale" }).click();
    for (const k of String(amount)) await till.getByRole("button", { name: k, exact: true }).click();
    await till.getByRole("button", { name: "Show Raast QR" }).click(); await sleep(800);
  };
  const payFromWallet = async (amountLabel) => {
    await phone.goto(`${WEB}/app/scan`); await sleep(1200);
    await phone.locator("#tills button", { hasText: amountLabel }).first().click();
    await phone.getByRole("slider").waitFor(); await sleep(400);
    await phone.getByRole("slider").focus(); await phone.keyboard.press("Enter");
    await phone.waitForURL(/\/app\/txn\//, { timeout: 20000 });
    return phone.url().split("/").pop();
  };
  const railLab = async (label, payer) => {
    await mc.goto(`${WEB}/control/rail-lab`); await sleep(900);
    if (label) { await mc.getByRole("radio", { name: new RegExp(label) }).click(); const apply = mc.getByRole("button", { name: "Apply scenario" }); if (await apply.isEnabled()) await apply.click(); await sleep(600); }
    if (payer) await mc.getByLabel("Test payment made by").selectOption(payer);
  };
  const trigger = async () => { await mc.getByRole("button", { name: /Trigger test payment/ }).click(); await sleep(2500); return (await mc.locator("ul li").filter({ hasText: /PAYA-|refused/ }).first().innerText()).trim(); };
  const heading = async () => (await phone.locator("h1", { hasText: /Processing|Paid|Under review|Declined/ }).first().innerText().catch(() => "")).trim();

  await scene("0. Set-up: Mission Control as Mudaser, till and wallet signed in", () => mc.screenshot({ path: `${OUT}/scene-0-overview.png` }), async (check) => {
    await mc.goto(`${WEB}/control`); await mc.evaluate(() => { localStorage.clear(); localStorage.setItem("paya.operator", "mudaser.ops"); });
    await mc.goto(`${WEB}/control`);
    check("Mission Control is live as Mudaser", await mc.getByText("Live", { exact: true }).waitFor({ timeout: 15000 }).then(() => true).catch(() => false));
    check("Raast rail badged as simulated", /Simulated/.test(await mc.locator("header").innerText()));
    await till.goto(`${WEB}/app`); await till.evaluate(() => localStorage.clear()); await till.goto(`${WEB}/app`);
    await till.getByText("Ayesha", { exact: true }).click(); check("till open", await till.getByText("New sale").waitFor().then(() => true));
    await phone.goto(`${WEB}/app`); await phone.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await phone.goto(`${WEB}/app`);
    await phone.getByText("Sara Ahmed", { exact: true }).click(); check("Sara's wallet open", await phone.getByText("Available to spend").waitFor().then(() => true));
  });

  let ref1;
  await scene("1. Normal payment: review → authorise → Paid only after Raast; till PAID; evidence in Mission Control", () => till.screenshot({ path: `${OUT}/scene-1-till.png` }), async (check) => {
    await sale(2450);
    ref1 = await payFromWallet("Rs 2,450");
    check("ledger settles it", await waitFor(async () => ["SETTLED", "RECONCILED"].includes(await status(ref1))), ref1);
    await phone.locator("h1", { hasText: "Paid" }).waitFor({ timeout: 10000 });
    check("wallet says Paid", (await heading()) === "Paid");
    check("till says PAID", await till.getByRole("heading", { name: "PAID" }).waitFor({ timeout: 10000 }).then(() => true).catch(() => false));
    await phone.getByRole("button", { name: /View receipt/ }).click(); await sleep(500);
    check("receipt shows the reference", (await phone.getByRole("dialog").innerText()).includes(ref1));
    await phone.screenshot({ path: `${OUT}/scene-1-receipt.png` }); await phone.keyboard.press("Escape");
    check("money trail from the ledger", /Where your money went/.test(await phone.locator("body").innerText()));
    await mc.getByLabel(/Search transactions by reference/).fill(ref1); await mc.keyboard.press("Enter"); await sleep(1200);
    await mc.getByText(ref1).first().click(); await sleep(1000);
    const d = await mc.getByRole("dialog").innerText();
    check("drawer shows AUTH_POST, SETTLE and FEE postings", ["AUTH_POST", "SETTLE", "FEE"].every((x) => d.includes(x)));
    await mc.screenshot({ path: `${OUT}/scene-1-control.png` }); await mc.keyboard.press("Escape");
  });

  await scene("2. Lost request: stays Processing (also after reopening), then recovery settles it exactly once", () => phone.screenshot({ path: `${OUT}/scene-2-wallet.png` }), async (check) => {
    await railLab("Lost request");
    await mc.screenshot({ path: `${OUT}/scene-2-raillab.png` });
    await sale(800);
    const ref = await payFromWallet("Rs 800");
    await phone.locator("h1", { hasText: /Processing|Paid/ }).first().waitFor({ timeout: 8000 });
    const h = await heading(); const st = await status(ref);
    check("while PENDING the wallet says Processing, not Paid", st === "PENDING" && h === "Processing", `${st}/${h}`);
    await phone.reload(); await sleep(1200);
    check("reopening still shows Processing (truth from the server)", (await heading()) === "Processing");
    await mc.getByRole("button", { name: "Restore healthy" }).click(); await sleep(400);
    check("recovery agent settles it", await waitFor(async () => (await status(ref)) === "SETTLED", 30000), ref);
    const tx = (await api(`/v1/transactions/${ref}`)).data;
    check("exactly one SETTLE posting", tx.ledger.filter((j) => j.posting_type === "SETTLE").length === 1);
    await phone.locator("h1", { hasText: "Paid" }).waitFor({ timeout: 8000 }).catch(() => {});
    check("wallet turns Paid by itself", (await heading()) === "Paid");
  });

  await scene("3. Compliance hold: no money moves; Ops can't decide; Kanz releases with a reason", () => mc.screenshot({ path: `${OUT}/scene-3-hold.png` }), async (check) => {
    await railLab(null, "zarak");
    const run = await trigger(); const ref = (run.match(/PAYA-\d{8}-[0-9A-F]{6}/) || [])[0];
    check("payment is under review", await waitFor(async () => (await status(ref)) === "UNDER_REVIEW"), ref);
    const tx = (await api(`/v1/transactions/${ref}`)).data;
    check("no ledger posting while held", tx.ledger.length === 0);
    const caseRef = tx.cases.find((c) => c.kind === "COMPLIANCE_HOLD").case_ref;
    await mc.goto(`${WEB}/control/cases?case=${caseRef}`); await sleep(1300);
    check("Ops sees the case but cannot decide", /Only Compliance can release or reject/.test(await mc.getByRole("dialog").innerText()));
    await actAs("Kanz");
    await mc.goto(`${WEB}/control/cases?case=${caseRef}`); await sleep(1300);
    await mc.getByRole("button", { name: "Release hold" }).click();
    await mc.getByLabel(/Reason/).fill("False positive: different date of birth and city on file");
    await mc.getByRole("dialog").last().getByRole("button", { name: "Release" }).click(); await sleep(1200);
    check("released payment settles", await waitFor(async () => (await status(ref)) === "SETTLED", 20000));
    const audit = (await api(`/v1/cases/${caseRef}`)).data.audit;
    check("Kanz's decision is in the audit trail", audit.some((a) => a.actor === "kanz.compliance"));
  });

  await scene("4. Raast outage: breaker opens, 4th payment refused before any debit, recovery settles the rest", () => mc.screenshot({ path: `${OUT}/scene-4-outage.png` }), async (check) => {
    await actAs("Mudaser");
    await railLab("Outage", "omar");
    const runs = [];
    for (let i = 0; i < 4; i++) runs.push(await trigger());
    check("4th payment refused (RAIL_UNAVAILABLE)", /refused/i.test(runs[3]) && /unavailable|rail/i.test(runs[3]), runs[3].slice(0, 80));
    const st = (await api("/v1/chaos/rail")).data;
    check("circuit breaker OPEN", st.breaker === "OPEN");
    await mc.getByRole("button", { name: "Restore healthy" }).click(); await sleep(500);
    await mc.getByRole("button", { name: /Ask the rail about all pending/ }).click(); await sleep(1500);
    const refs = runs.map((r) => (r.match(/PAYA-\d{8}-[0-9A-F]{6}/) || [])[0]).filter(Boolean);
    check("payments sent before the breaker opened settle exactly once",
      await waitFor(async () => (await Promise.all(refs.map(status))).every((s) => s === "SETTLED"), 30000), refs.join(","));
  });

  await scene("5. Reconciliation break → AI suggestion → owner resolves; same file refused", () => mc.screenshot({ path: `${OUT}/scene-5-resolved.png` }), async (check) => {
    await railLab("Missing line", "sara");
    const run = await trigger(); const ref = (run.match(/PAYA-\d{8}-[0-9A-F]{6}/) || [])[0];
    await waitFor(async () => (await status(ref)) === "SETTLED");
    await mc.getByRole("button", { name: "Restore healthy" }).click(); await sleep(300);
    await actAs("Rufayl");
    await mc.goto(`${WEB}/control/recon`); await sleep(900);
    await mc.getByRole("button", { name: "Import and reconcile" }).click(); await sleep(2200);
    const runs = (await api("/v1/finance/recon/runs", { as: "rufayl.finance" })).data;
    const items = (await api(`/v1/finance/recon/runs/${runs[0].id}/items`)).data.items;
    const brk = items.find((i) => i.txn_ref === ref && i.case);
    check("missing line becomes an owned case", !!brk, brk && `${brk.category} → ${brk.case.case_ref}`);
    await mc.screenshot({ path: `${OUT}/scene-5-recon.png` });
    await actAs(brk.case.owner_role === "FINANCE" ? "Rufayl" : "Mudaser");
    await mc.goto(`${WEB}/control/cases?case=${brk.case.case_ref}`); await sleep(1200);
    await mc.getByRole("button", { name: "Take it" }).click(); await sleep(900);
    // The triage agent reacts to new breaks by itself; ask only if it hasn't suggested anything yet.
    if (!(await api(`/v1/cases/${brk.case.case_ref}`)).data.ai.length) await mc.getByRole("button", { name: /Ask AI/ }).click();
    const ai = await waitFor(async () => (await api(`/v1/cases/${brk.case.case_ref}`)).data.ai.length > 0, 15000);
    check("AI suggestion recorded (advisory)", !!ai);
    await mc.goto(`${WEB}/control/cases?case=${brk.case.case_ref}`); await sleep(1500); await mc.screenshot({ path: `${OUT}/scene-5-ai.png` });
    await mc.getByRole("button", { name: "Accept suggestion" }).click(); await sleep(900);
    await mc.getByRole("button", { name: "Resolve with evidence" }).click(); await sleep(1200);
    const cd = (await api(`/v1/cases/${brk.case.case_ref}`)).data;
    check("owner resolved it; suggestion accepted by a person", cd.state === "RESOLVED" && cd.ai.at(-1).reviewer_decision === "ACCEPTED");
    await actAs("Rufayl");
    await mc.goto(`${WEB}/control/recon`); await sleep(900);
    await mc.getByRole("button", { name: "Import the same file again" }).click(); await sleep(1400);
    check("same settlement file refused", /File already imported|already/i.test(await mc.locator("body").innerText()));
  });

  await scene("6. New themes: onboarding referral → two-person approval; Paya Assistant", () => phone.screenshot({ path: `${OUT}/scene-6-assistant.png` }), async (check) => {
    await phone.goto(`${WEB}/app/account`); await sleep(700);
    await phone.getByRole("button", { name: "Sign out" }).click(); await sleep(600);
    await phone.goto(`${WEB}/app/open`); await sleep(500);
    await phone.getByText("I agree to the Paya prototype terms").click(); await phone.getByText("I agree to Paya processing my photos").click();
    await phone.getByRole("button", { name: /Let's go/ }).click();
    const uname = `zarak.k${Date.now() % 100000}`;
    await phone.getByLabel("Full name").fill("Zarak Khanzad"); await phone.getByLabel("Date of birth").fill("1990-02-14");
    await phone.getByLabel("Mobile").fill("0300 5550199"); await phone.getByLabel("Username").fill(uname); await phone.getByLabel("Password").fill("demo-password-2026");
    await phone.getByRole("button", { name: /Continue/ }).click();
    await phone.getByRole("button", { name: /Take photo/ }).waitFor(); await sleep(1200);
    await phone.getByRole("button", { name: /Take photo/ }).click(); await phone.getByRole("button", { name: /Check my card/ }).click();
    await phone.getByRole("button", { name: /^Start$/ }).waitFor({ timeout: 15000 }); await sleep(900);
    await phone.getByRole("button", { name: /^Start$/ }).click();
    const end = Date.now() + 45000; let retries = 0;
    while (Date.now() < end) {
      const text = await phone.locator("body").innerText();
      await phone.evaluate((v) => { window.__turn = v; }, /turn your head to your left/i.test(text) ? 1 : /turn your head to your right/i.test(text) ? -1 : 0);
      if (/wallet is open|person is checking/i.test(text)) break;
      const retry = phone.getByRole("button", { name: /Try again/ });
      if (retries < 2 && await retry.isVisible().catch(() => false) && await retry.isEnabled().catch(() => false)) { retries++; await retry.click(); }
      await sleep(120);
    }
    const t = await phone.locator("body").innerText();
    check("near-watch-list name referred, no tipping off", /person is checking/i.test(t) && !/screen|watch|sanction/i.test(t));
    const app = (await api("/v1/kyc/applications?state=REFERRED", { as: "kanz.compliance" })).data.find((a) => a.full_name === "Zarak Khanzad");
    await actAs("Kanz");
    await mc.goto(`${WEB}/control/kyc?app=${app.ref}`); await sleep(1300);
    const approve = async (btn) => { await mc.getByRole("button", { name: btn }).click(); await mc.getByLabel(/Reason/).fill("Reviewed: different date of birth from the list entry"); await mc.getByRole("dialog").last().getByRole("button", { name: "Approve" }).click(); await sleep(1400); };
    await approve("Recommend approval");
    await approve(/Confirm approval/);
    check("same officer's confirmation refused by the server", /Needs a different person/.test(await mc.locator("body").innerText()));
    await mc.screenshot({ path: `${OUT}/scene-6-two-person.png` });
    await actAs("Harris");
    await mc.goto(`${WEB}/control/kyc?app=${app.ref}`); await sleep(1300);
    await approve(/Confirm approval/);
    check("second officer approves", (await api(`/v1/kyc/applications/${app.ref}`)).data.state === "APPROVED");
    check("phone flips to 'wallet is open'", await phone.getByText(/wallet is open/i).waitFor({ timeout: 15000 }).then(() => true).catch(() => false));
    await phone.getByRole("button", { name: /Start using Paya/ }).click(); await sleep(1500);
    await phone.goto(`${WEB}/app/assistant`); await sleep(600);
    const ask = async (q) => { await phone.getByLabel("Message the assistant").fill(q); await phone.keyboard.press("Enter"); await sleep(1400); return phone.locator('[role="log"]').innerText(); };
    check("Roman Urdu balance question answered from the ledger", /Rs 5,000 available/.test(await ask("mera balance kitna hai")));
    check("assistant cannot move money", /can't send money from chat/i.test(await ask("send 500 to Ali")));
  });

  await scene("7. Evidence: audit chain intact, denials visible (as Auditor)", () => mc.screenshot({ path: `${OUT}/scene-7-audit.png` }), async (check) => {
    await actAs("Taha");
    await mc.goto(`${WEB}/control/audit`); await sleep(1400);
    const a = await mc.locator("body").innerText();
    check("hash chain intact", /Hash chain intact/.test(a));
    check("denials are recorded (e.g. Kanz's self-confirmation)", /DENIED/.test(a));
    const integ = (await api("/v1/finance/integrity", { as: "taha.audit" })).data;
    check("integrity checks have no FAIL", integ.checks.every((c) => c.status !== "FAIL"), integ.overall);
  });

  await browser.close();
  const total = scenes.reduce((a, s) => a + s.seconds, 0);
  const ok = scenes.every((s) => s.checks.every((c) => c.ok)) && pageErrors.length === 0;
  const date = new Date().toISOString().slice(0, 10);
  const md = [`# Demo rehearsal (Paya 2.0), ${date}`, "",
    `**Result: ${ok ? "PASS" : "FAIL"}** · ${scenes.reduce((a, s) => a + s.checks.length, 0)} checks · automated run time ${total.toFixed(0)} s (the live demo adds narration; script target about 10 min) · page errors: ${pageErrors.length}`, "",
    "Generated by `docs/architecture/tools/demo_rehearsal.cjs` against the real stack on fresh synthetic data. Screenshots: `scene-*.png`.", "",
    ...scenes.flatMap((s) => [`## ${s.name} (${s.seconds.toFixed(1)} s)`, "", ...s.checks.map((c) => `- ${c.ok ? "PASS" : "**FAIL**"} ${c.label}${c.note ? ` (${c.note})` : ""}`), ""]),
    ...(pageErrors.length ? ["## Page errors", "", ...pageErrors.map((e) => `- ${e}`)] : [])].join("\n");
  fs.writeFileSync(path.join(OUT, `rehearsal-${date}.md`), md);
  console.log(`\n${ok ? "REHEARSAL PASSED" : "REHEARSAL FAILED"} in ${total.toFixed(0)} s`);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
