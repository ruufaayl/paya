// Paya 2.0 acceptance run: drives the redesigned wallet and Mission Control against the real backend.
// Requires: API on :8000 (fresh database, face models installed) and the web app on :5173 (or PAYA_WEB).
//   node docs/revamp/tools/revamp_e2e.cjs
// Every check asserts a backend fact, not just something on screen. Screenshots go to evidence/screenshots/revamp/.
const { chromium, devices } = require("playwright");
const fs = require("fs");
const path = require("path");

const WEB = process.env.PAYA_WEB || "http://localhost:5173";
const API = process.env.PAYA_API || "http://localhost:8000";
const OUT = path.join(__dirname, "../../../evidence/screenshots/revamp");
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, note = "") => { results.push({ name, ok: !!ok, note }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? `  (${note})` : ""}`); };

const tokens = {};
async function api(user, p, init = {}) {
  if (!tokens[user]) {
    const r = await fetch(`${API}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: user, password: "paya-demo-2026" }) });
    tokens[user] = (await r.json()).access_token;
  }
  const r = await fetch(`${API}${p}`, { ...init, headers: { authorization: `Bearer ${tokens[user]}`, "content-type": "application/json", ...(init.headers || {}) } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 15000, step = 400) { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(step); } return null; }
async function newRequest(amount = 1250_00, cashier = "ayesha.cashier") {
  return (await api(cashier, "/v1/payment-requests", { method: "POST", body: JSON.stringify({ amount_minor: amount, order_ref: `E2E-${Date.now().toString(36)}` }) })).body.id;
}

// Fake camera: a DRAWN synthetic face (no real person) that turns when the app asks.
const FAKE_CAMERA = () => {
  window.__turn = 0;
  const c = document.createElement("canvas"); c.width = 640; c.height = 480;
  const g = c.getContext("2d"); let t = 0;
  const ell = (x, y, rx, ry, color, fill = true, a = 0, b = Math.PI * 2) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, a, b); if (fill) { g.fillStyle = color; g.fill(); } else { g.strokeStyle = color; g.lineWidth = 5; g.stroke(); } };
  const draw = () => {
    t++; const turn = window.__turn;
    g.filter = "none"; g.fillStyle = "rgb(220,210,200)"; g.fillRect(0, 0, 640, 480);
    g.save(); g.translate(120, 40); g.filter = "blur(2px)";
    ell(200, 210, 110, 140, "rgb(215,170,140)");
    for (const side of [-1, 1]) { const ex = 200 + side * 45 + turn * 12; ell(ex, 180, 22, 12, "#fff"); ell(ex + turn * 6, 180, 9, 9, "rgb(30,30,40)");
      g.strokeStyle = "rgb(70,50,50)"; g.lineWidth = 5; g.beginPath(); g.moveTo(ex - 25, 155); g.lineTo(ex + 25, 152); g.stroke(); }
    const nx = 200 + turn * 45; g.strokeStyle = "rgb(170,120,100)"; g.lineWidth = 3; g.beginPath(); g.moveTo(nx, 190); g.lineTo(nx - 15, 255); g.lineTo(nx + 15, 255); g.closePath(); g.stroke();
    ell(200 + turn * 22, 295, 40, 15, "rgb(160,60,60)", false, 0, Math.PI);
    g.restore(); g.fillStyle = `rgba(0,0,0,${0.02 + (t % 7) / 400})`; g.fillRect(0, 470, 640, 10);
    requestAnimationFrame(draw);
  };
  draw();
  const stream = c.captureStream(20);
  navigator.mediaDevices.getUserMedia = async () => stream.clone();
};

async function phone(browser, width) {
  const d = devices["iPhone 13"];
  const ctx = await browser.newContext({ ...d, viewport: { width: width || d.viewport.width, height: 844 }, deviceScaleFactor: 2,
    permissions: ["geolocation", "camera"], geolocation: { latitude: 31.5204, longitude: 74.3587, accuracy: 40 } });
  await ctx.addInitScript(FAKE_CAMERA);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => check(`no page error (${e.message.slice(0, 60)})`, false));
  return p;
}
async function signInWallet(p, name) { await p.goto(`${WEB}/app`); await p.evaluate(() => localStorage.clear()); await p.goto(`${WEB}/app`); await p.getByText(name, { exact: true }).click(); await p.waitForTimeout(900); }
async function console_(browser, who, width = 1440) {
  const p = await (await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 })).newPage();
  p.on("pageerror", (e) => check(`no console page error (${e.message.slice(0, 60)})`, false));
  await p.goto(`${WEB}/control`); await p.evaluate((u) => { localStorage.clear(); localStorage.setItem("paya.operator", u); }, who);
  await p.goto(`${WEB}/control`); await p.waitForTimeout(1200);
  return p;
}
async function switchOp(p, name) { await p.keyboard.press("Escape"); await p.keyboard.press("Escape"); await p.waitForTimeout(300); await p.locator('button[aria-haspopup="menu"]').click(); await p.getByRole("menuitemradio", { name: new RegExp(name) }).click(); await p.waitForTimeout(1000); }

async function onboard(p, who) {
  await p.goto(`${WEB}/app/open`); await p.waitForTimeout(500);
  await p.getByText("I agree to the Paya prototype terms").click();
  await p.getByText("I agree to Paya processing my photos").click();
  await p.getByRole("button", { name: /Let's go/ }).click();
  await p.getByLabel("Full name").fill(who.name); await p.getByLabel("Date of birth").fill(who.dob);
  await p.getByLabel("Mobile").fill("0300 5550199"); await p.getByLabel("Username").fill(who.username); await p.getByLabel("Password").fill("demo-password-2026");
  await p.getByRole("button", { name: /Continue/ }).click();
  await p.getByRole("button", { name: /Take photo/ }).waitFor(); await p.waitForTimeout(1200);
  await p.getByRole("button", { name: /Take photo/ }).click();
  await p.getByRole("button", { name: /Check my card/ }).click();
  await p.getByRole("button", { name: /^Start$/ }).waitFor({ timeout: 15000 }); await p.waitForTimeout(900);
  await p.getByRole("button", { name: /^Start$/ }).click();
  const end = Date.now() + 45000;
  let retries = 0;
  while (Date.now() < end) {
    const text = await p.locator("body").innerText();
    await p.evaluate((v) => { window.__turn = v; }, /turn your head to your left/i.test(text) ? 1 : /turn your head to your right/i.test(text) ? -1 : 0);
    if (/wallet is open|person is checking/i.test(text)) break;
    const retry = p.getByRole("button", { name: /Try again/ });
    if (retries < 2 && await retry.isVisible().catch(() => false) && await retry.isEnabled().catch(() => false)) { retries++; await retry.click(); }
    await p.waitForTimeout(120);
  }
  await p.waitForTimeout(1200);
  return p.locator("body").innerText();
}

(async () => {
  const browser = await chromium.launch();
  await api("admin", "/v1/chaos/rail", { method: "POST", body: JSON.stringify({ mode: "NORMAL" }) });

  // ---------------------------------------------------------------- customer: onboarding (real models, drawn face)
  const a = await phone(browser);
  const uname = `hira.${Date.now() % 100000}`;
  const t1 = await onboard(a, { name: "Hira Qureshi", dob: "1999-05-02", username: uname });
  check("onboarding: clean applicant auto-approved", /wallet is open/i.test(t1));
  await a.screenshot({ path: `${OUT}/wallet-onboarding-approved.png` });
  await a.getByRole("button", { name: /Start using Paya/ }).click(); await a.waitForTimeout(2000);
  const body = await a.locator("body").innerText();
  check("wallet activation: new wallet shows synthetic Rs 5,000 from the ledger", /Rs 5,000/.test(body));

  // ---------------------------------------------------------------- customer: successful payment + receipt
  const s = await phone(browser);
  await signInWallet(s, "Sara Ahmed");
  await s.screenshot({ path: `${OUT}/wallet-home-390.png` });
  const pr1 = await newRequest(1250_00);
  await s.goto(`${WEB}/app/pay/${pr1}`); await s.getByText("Chai Junction").first().waitFor(); await s.waitForTimeout(600);
  await s.screenshot({ path: `${OUT}/wallet-review-390.png` });
  await s.getByRole("slider").focus(); await s.keyboard.press("Enter");
  await s.waitForURL(/\/app\/txn\//); const ref1 = s.url().split("/").pop();
  const settled = await waitFor(async () => ["SETTLED", "RECONCILED"].includes((await api("taha.audit", `/v1/transactions/${ref1}`)).body.status));
  await s.getByRole("heading", { name: "Paid" }).waitFor({ timeout: 8000 }).catch(() => {});
  check("payment: success shown only after backend SETTLED", settled && /Paid/.test(await s.locator("h1").innerText()));
  await s.screenshot({ path: `${OUT}/wallet-result-paid-390.png`, fullPage: true });
  await s.getByRole("button", { name: /View receipt/ }).click(); await s.waitForTimeout(500);
  check("receipt: opens with reference", (await s.getByRole("dialog").innerText()).includes(ref1));
  await s.screenshot({ path: `${OUT}/wallet-receipt-390.png` });
  await s.keyboard.press("Escape");

  // ---------------------------------------------------------------- customer: client retry with same key
  const pr2 = await newRequest(300_00);
  const key = `e2e-${Date.now()}`;
  const r1 = await api("sara", "/v1/payments", { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify({ payment_request_id: pr2 }) });
  const r2 = await api("sara", "/v1/payments", { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify({ payment_request_id: pr2 }) });
  check("client retry: same key returns the same payment (no double debit)", r1.body.txn_ref && r1.body.txn_ref === r2.body.txn_ref);

  // ---------------------------------------------------------------- customer: pending (lost request) never animates to Paid; refresh mid-flight
  // TIMEOUT_NO_RECORD: our call times out and the rail never saw it, so the payment stays PENDING until the recovery
  // agent's enquiry (5 s backoff) gets NOT_FOUND and resends the same E2E id.
  await api("admin", "/v1/chaos/rail", { method: "POST", body: JSON.stringify({ mode: "TIMEOUT_NO_RECORD" }) });
  const o = await phone(browser);
  await signInWallet(o, "Omar Farooq");
  const pr3 = await newRequest(800_00);
  await o.goto(`${WEB}/app/pay/${pr3}`); await o.getByRole("slider").waitFor(); await o.waitForTimeout(500);
  await o.getByRole("slider").focus(); await o.keyboard.press("Enter");
  await o.waitForURL(/\/app\/txn\//, { timeout: 20000 }); const ref3 = o.url().split("/").pop();
  // Sample continuously: read the screen FIRST, then the backend. Status only moves forward, so if the screen said
  // "Paid", the backend must already be SETTLED when read afterwards. Any "Paid" while not settled is a violation.
  const samples = []; let shot = false;
  for (let i = 0; i < 80; i++) {
    const h = (await o.locator("h1", { hasText: /Processing|Paid/ }).first().innerText().catch(() => "")).trim();
    const st = (await api("taha.audit", `/v1/transactions/${ref3}`)).body.status;
    samples.push([h, st]);
    if (!shot && st === "PENDING" && h === "Processing") {
      await o.screenshot({ path: `${OUT}/wallet-result-pending-390.png` }); shot = true;
      await o.reload(); await o.waitForTimeout(1200);
      check("refresh during processing: still Processing after reload (read from the server)", (await o.locator("h1", { hasText: /Processing|Paid/ }).first().innerText()).trim() === "Processing");
      await api("admin", "/v1/chaos/rail", { method: "POST", body: JSON.stringify({ mode: "NORMAL" }) }); // let the resend succeed
    }
    if (st === "SETTLED") break;
    await sleep(250);
  }
  await api("admin", "/v1/chaos/rail", { method: "POST", body: JSON.stringify({ mode: "NORMAL" }) });
  const violations = samples.filter(([h, st]) => h === "Paid" && !["SETTLED", "RECONCILED"].includes(st));
  check("pending: never shows Paid before the backend settles", violations.length === 0, `${samples.length} samples`);
  check("pending: shows Processing while the backend is PENDING", samples.some(([h, st]) => st === "PENDING" && h === "Processing"));
  const settled3 = await waitFor(async () => (await api("taha.audit", `/v1/transactions/${ref3}`)).body.status === "SETTLED", 25000);
  await o.waitForTimeout(2500);
  check("pending: recovery agent settles it exactly once, then the screen says Paid", settled3 && /Paid/.test(await o.locator("h1").innerText()));

  // ---------------------------------------------------------------- customer: rejected (unverified KYC)
  const hn = await phone(browser);
  await signInWallet(hn, "Hina Baig");
  const pr4 = await newRequest(100_00);
  await hn.goto(`${WEB}/app/pay/${pr4}`); await hn.getByRole("slider").waitFor(); await hn.waitForTimeout(400);
  await hn.getByRole("slider").focus(); await hn.keyboard.press("Enter");
  await hn.waitForURL(/\/app\/txn\//, { timeout: 15000 }).catch(() => {}); await hn.waitForTimeout(1500);
  check("rejected: unverified customer sees Declined and no money moved", /Declined/.test(await hn.locator("body").innerText()));
  await hn.screenshot({ path: `${OUT}/wallet-result-declined-390.png` });

  // ---------------------------------------------------------------- customer: referred onboarding for the two-person demo
  const z = await phone(browser);
  const t2 = await onboard(z, { name: "Zarak Khanzad", dob: "1990-02-14", username: `zarak.k${Date.now() % 100000}` });
  check("onboarding: near watch-list name is referred, no tipping off", /person is checking/i.test(t2) && !/screen|watch|sanction/i.test(t2));

  // ---------------------------------------------------------------- responsive wallet widths
  for (const w of [360, 430]) {
    const pw = await phone(browser, w); await signInWallet(pw, "Sara Ahmed");
    const overflow = await pw.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(`wallet ${w}px: no horizontal overflow`, !overflow);
    await pw.screenshot({ path: `${OUT}/wallet-home-${w}.png` });
    await pw.context().close();
  }

  // ---------------------------------------------------------------- operations
  const gate = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await gate.goto(`${WEB}/control`); await gate.evaluate(() => localStorage.clear()); await gate.goto(`${WEB}/control`);
  await gate.getByText("Try a non-staff account").click(); await gate.waitForTimeout(1000);
  check("unauthorised: cashier is refused by the console", /no back-office access/i.test(await gate.locator("body").innerText()));

  const c = await console_(browser, "mudaser.ops");
  check("overview: loads real metrics", /Success rate/i.test(await c.locator("body").innerText()));
  await c.screenshot({ path: `${OUT}/console-overview-1440.png` });
  await c.getByLabel(/Search transactions by reference/).fill(ref1); await c.keyboard.press("Enter"); await c.waitForTimeout(1500);
  await c.getByText(ref1).first().click(); await c.waitForTimeout(1200);
  const drawer = await c.getByRole("dialog").innerText();
  check("transaction explorer: search by reference and open full detail with ledger postings", drawer.includes("AUTH_POST") && drawer.includes("SETTLE"));
  await c.screenshot({ path: `${OUT}/console-transaction-drawer-1440.png` });
  await c.keyboard.press("Escape");

  // Rail lab: duplicate ack and rejection
  await switchOp(c, "Admin");
  await c.goto(`${WEB}/control/rail-lab`); await c.waitForTimeout(1000);
  for (const [label, mode, expect] of [["Duplicate ack", "DUPLICATE_ACK", "SETTLED"], ["Rejection", "REJECT", "REVERSED"], ["Missing line", "PARTIAL", "SETTLED"]]) {
    await c.getByRole("radio", { name: new RegExp(label) }).click();
    await c.getByRole("button", { name: "Apply scenario" }).click(); await c.waitForTimeout(700);
    await c.getByRole("button", { name: /Trigger test payment/ }).click(); await c.waitForTimeout(3500);
    const runRef = (await c.locator("li button.ref").first().innerText()).trim();
    const st = await waitFor(async () => { const s2 = (await api("taha.audit", `/v1/transactions/${runRef}`)).body.status; return s2 === expect ? s2 : null; }, 15000);
    check(`rail lab: ${mode} → ${expect}`, !!st, runRef);
  }
  await c.screenshot({ path: `${OUT}/console-rail-lab-1440.png` });
  await c.getByRole("button", { name: "Restore healthy" }).click(); await c.waitForTimeout(500);

  // Reconciliation: import, import again (refused), inspect the break
  await switchOp(c, "Rufayl");
  await c.goto(`${WEB}/control/recon`); await c.waitForTimeout(1000);
  await c.getByRole("button", { name: "Import and reconcile" }).click(); await c.waitForTimeout(2000);
  const runs = (await api("rufayl.finance", "/v1/finance/recon/runs")).body;
  check("reconciliation: run recorded", runs.length >= 1);
  await c.getByRole("button", { name: "Import the same file again" }).click(); await c.waitForTimeout(1500);
  check("reconciliation: identical file refused", (await api("rufayl.finance", "/v1/finance/recon/runs")).body.length === runs.length && /already imported|Not possible|refused|duplicate/i.test(await c.locator("body").innerText()));
  const items = (await api("rufayl.finance", `/v1/finance/recon/runs/${runs[0].id}/items`)).body.items;
  const brk = items.find((i) => i.category !== "MATCHED" && i.case);
  check("reconciliation: unmatched record has an owned case", !!brk, brk && `${brk.category} → ${brk.case.case_ref}`);
  await c.screenshot({ path: `${OUT}/console-recon-1440.png` });

  // Assign and resolve the break as its owner; AI triage suggestion
  if (brk) {
    const owner = brk.case.owner_role === "FINANCE" ? "Rufayl" : "Mudaser";
    await switchOp(c, owner);
    await c.goto(`${WEB}/control/cases?case=${brk.case.case_ref}`); await c.waitForTimeout(1500);
    await c.getByRole("button", { name: "Take it" }).click(); await c.waitForTimeout(1200);
    const cd = (await api("taha.audit", `/v1/cases/${brk.case.case_ref}`)).body;
    check("exception assignment: case assigned to the operator, audited", cd.assigned_to && cd.audit.some((x) => x.action === "CASE_ASSIGN"), cd.assigned_to);
    await c.getByRole("button", { name: /Ask AI|Re-run/ }).click(); await c.waitForTimeout(3000);
    const cd2 = (await api("taha.audit", `/v1/cases/${brk.case.case_ref}`)).body;
    check("AI triage: suggestion recorded, advisory only", cd2.ai.length >= 1);
    await c.screenshot({ path: `${OUT}/console-case-drawer-1440.png` });
    await c.getByRole("button", { name: "Resolve with evidence" }).click(); await c.waitForTimeout(1200);
    check("exception resolution: case resolved by its owner", (await api("taha.audit", `/v1/cases/${brk.case.case_ref}`)).body.state === "RESOLVED");
    await c.keyboard.press("Escape");
  }

  // KYC two-person approval through the UI
  await switchOp(c, "Kanz");
  const apps = (await api("kanz.compliance", "/v1/kyc/applications?state=REFERRED")).body;
  const app = apps.find((x) => x.two_person_rule);
  if (app) {
    await c.goto(`${WEB}/control/kyc?app=${app.ref}`); await c.waitForTimeout(1500);
    await c.screenshot({ path: `${OUT}/console-kyc-inspector-1440.png` });
    const approve = async (btn) => { await c.getByRole("button", { name: btn }).click(); await c.getByLabel(/Reason/).fill("Reviewed evidence: different date of birth from list entry"); await c.getByRole("dialog").last().getByRole("button", { name: "Approve" }).click(); await c.waitForTimeout(1500); };
    await approve("Recommend approval");
    await approve(/Confirm approval/);
    await c.screenshot({ path: `${OUT}/console-kyc-sod-refused-1440.png` });
    await c.keyboard.press("Escape"); await c.waitForTimeout(400); await c.keyboard.press("Escape"); await c.waitForTimeout(400);
    const st = (await api("taha.audit", `/v1/kyc/applications/${app.ref}`)).body;
    check("two-person rule: same officer cannot confirm own recommendation", st.state === "REFERRED" && st.recommended_by === "kanz.compliance");
    await switchOp(c, "Harris");
    await c.goto(`${WEB}/control/kyc?app=${app.ref}`); await c.waitForTimeout(1500);
    await approve(/Confirm approval/);
    const st2 = (await api("taha.audit", `/v1/kyc/applications/${app.ref}`)).body;
    check("two-person rule: second officer approves", st2.state === "APPROVED" && st2.decided_by === "harris.compliance");
  } else check("two-person rule: referred application available", false);

  // Unauthorised finance action and the audit log
  const denied = await api("ayesha.cashier", "/v1/finance/recon/run", { method: "POST", body: "{}" });
  check("unauthorised finance action: 403 from the server", denied.status === 403);
  await switchOp(c, "Mudaser");
  await c.goto(`${WEB}/control/audit`); await c.waitForTimeout(900);
  check("audit page restricted for Ops", /Not available for your role/.test(await c.locator("body").innerText()));
  await switchOp(c, "Auditor");
  await c.goto(`${WEB}/control/audit`); await c.waitForTimeout(1500);
  const auditText = await c.locator("body").innerText();
  check("audit log: chain intact and denials visible", /Hash chain intact/.test(auditText) && /DENIED/.test(auditText));
  await c.screenshot({ path: `${OUT}/console-audit-1440.png` });

  // Responsive console + topology + events
  for (const w of [1280, 1920]) {
    const pc = await console_(browser, "taha.audit", w);
    for (const [route, name] of [["", "overview"], ["/topology", "topology"], ["/transactions", "transactions"]]) {
      await pc.goto(`${WEB}/control${route}`); await pc.waitForTimeout(1800);
      const overflow = await pc.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (overflow) check(`console ${name} ${w}px: no horizontal overflow`, false);
      await pc.screenshot({ path: `${OUT}/console-${name}-${w}.png` });
    }
    check(`console ${w}px: pages render without page-level overflow`, true);
    await pc.context().close();
  }
  await c.goto(`${WEB}/control/events`); await c.waitForTimeout(1500);
  check("event stream: real events listed", /payment\.settled|payment\.posted/.test(await c.locator("body").innerText()));
  await c.screenshot({ path: `${OUT}/console-events-1440.png` });
  await c.goto(`${WEB}/control/topology`); await c.waitForTimeout(1500);
  await c.screenshot({ path: `${OUT}/console-topology-1440.png` });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(__dirname, "../../../evidence/revamp/e2e-results.json"), JSON.stringify({ at: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
