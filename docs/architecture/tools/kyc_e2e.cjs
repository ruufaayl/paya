// Theme 1 browser run for Rupay 2.0: digital onboarding with the REAL face models (YuNet + SFace) in an emulated
// iPhone, then the two-person rule in Mission Control. The phone's camera is a canvas drawing an entirely
// synthetic face (no real person) that turns when the app asks, so real landmarks and a real match are computed.
// The 1.x version of this run and its screenshots are kept in evidence/kyc/v1/ and evidence/screenshots/kyc/v1/.
//
//   make models  (once) ; API on :8000 with a fresh database ; web on :5173 (or set PAYA_WEB)
//   node docs/architecture/tools/kyc_e2e.cjs      -> evidence/kyc/e2e-run.txt, evidence/screenshots/kyc/*.png
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");

const WEB = process.env.PAYA_WEB || "http://localhost:5173";
const API = process.env.PAYA_API || "http://localhost:8000";
const OUT = path.join(__dirname, "../../../evidence/screenshots/kyc");
const LOG = path.join(__dirname, "../../../evidence/kyc/e2e-run.txt");
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
const results = [];
const check = (n, ok, note = "") => { results.push({ n, ok: !!ok }); say(`${ok ? "PASS" : "FAIL"}  ${n}${note ? `  (${note})` : ""}`); };
const tokens = {};
async function token(u) { if (!tokens[u]) { const r = await fetch(`${API}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: "paya-demo-2026" }) }); tokens[u] = (await r.json()).access_token; } return tokens[u]; }
async function api(u, p, init = {}) { const r = await fetch(`${API}${p}`, { ...init, headers: { authorization: `Bearer ${await token(u)}`, "content-type": "application/json", ...(init.headers || {}) } }); return { status: r.status, body: await r.json().catch(() => ({})) }; }

// A DRAWN synthetic face (no real person) that turns when the app asks.
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

async function phone(browser) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 2, permissions: ["geolocation", "camera"],
    geolocation: { latitude: 31.5204, longitude: 74.3587, accuracy: 40 } });
  await ctx.addInitScript(FAKE_CAMERA);
  return ctx.newPage();
}

async function onboard(p, who, shots) {
  const snap = async (n) => { if (shots) await p.screenshot({ path: `${OUT}/${shots}-${n}.png` }); };
  await p.goto(`${WEB}/app`); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await p.goto(`${WEB}/app/open`); await p.waitForTimeout(600); await snap("1-intro");
  await p.getByText("I agree to the Rupay prototype terms").click();
  await p.getByText("I agree to Rupay processing my photos").click();
  await p.getByRole("button", { name: /Let's go/ }).click();
  await p.getByLabel("Full name").fill(who.name); await p.getByLabel("Date of birth").fill(who.dob);
  await p.getByLabel("Mobile").fill("0300 5550199"); await p.getByLabel("Username").fill(who.username); await p.getByLabel("Password").fill("demo-password-2026");
  await snap("2-details");
  await p.getByRole("button", { name: /Continue/ }).click();
  await p.getByRole("button", { name: /Take photo/ }).waitFor(); await p.waitForTimeout(1200); await snap("3-specimen-card");
  await p.getByRole("button", { name: /Take photo/ }).click();
  await p.getByRole("button", { name: /Check my card/ }).click();
  await p.getByRole("button", { name: /^Start$/ }).waitFor({ timeout: 15000 }); await p.waitForTimeout(900);
  await p.getByRole("button", { name: /^Start$/ }).click();
  const end = Date.now() + 45000; let retries = 0, shotLive = false;
  while (Date.now() < end) {
    const text = await p.locator("body").innerText();
    await p.evaluate((v) => { window.__turn = v; }, /turn your head to your left/i.test(text) ? 1 : /turn your head to your right/i.test(text) ? -1 : 0);
    if (!shotLive && /turn your head/i.test(text)) { shotLive = true; await snap("4-liveness"); }
    if (/wallet is open|person is checking/i.test(text)) break;
    const retry = p.getByRole("button", { name: /Try again/ });
    if (retries < 2 && await retry.isVisible().catch(() => false) && await retry.isEnabled().catch(() => false)) { retries++; await retry.click(); }
    await p.waitForTimeout(120);
  }
  await p.waitForTimeout(1200); await snap("5-result");
  return { text: await p.locator("body").innerText(), retries };
}

async function findApp(name) {
  const all = (await api("taha.audit", "/v1/kyc/applications")).body;
  const hit = (all.items || all).find((a) => a.full_name === name);
  return hit ? (await api("taha.audit", `/v1/kyc/applications/${hit.ref}`)).body : null;
}

(async () => {
  say(`# Theme 1 browser run (Rupay 2.0) - ${new Date().toISOString()}`);
  say(`Engine: ${JSON.stringify((await api("mudaser.ops", "/v1/kyc/engine")).body)}`);
  const b = await chromium.launch();

  // 1. A clean applicant: every check passes, the machine approves, the wallet opens with its welcome credit.
  const a = await phone(b);
  const uname = `hira.q${Date.now() % 100000}`;
  const r1 = await onboard(a, { name: "Hira Qureshi", dob: "1999-05-02", username: uname }, "a");
  check("clean applicant approved automatically with the real models", /wallet is open/i.test(r1.text), `liveness retries: ${r1.retries}`);
  const app1 = await findApp("Hira Qureshi");
  const face = app1 && app1.checks.find((c) => c.check === "FACE_MATCH");
  const live = app1 && app1.checks.filter((c) => c.check === "LIVENESS");
  check("face match scored by SFace above its published threshold", face && face.outcome === "PASS", face ? `cosine ${face.score}` : "no check");
  check("liveness passed on the head-turn challenge", live && live.some((c) => c.outcome === "PASS"), live ? live.map((c) => c.outcome).join(", ") : "");
  check("every automated check recorded with its engine and evidence", app1 && app1.checks.length >= 6 && app1.decision === "AUTO_APPROVED", app1 ? `${app1.checks.length} checks` : "");
  const goOn = a.getByRole("button", { name: /Go to my wallet|Open my wallet|Continue/ }).first();
  if (await goOn.isVisible().catch(() => false)) { await goOn.click(); await a.waitForTimeout(1500); }
  await a.screenshot({ path: `${OUT}/a-6-wallet.png` });

  // 2. A near watch-list name: referred to a person, and the applicant is not told why.
  const z = await phone(b);
  const r2 = await onboard(z, { name: "Zarak Khanzad", dob: "1990-02-14", username: `zarak.k${Date.now() % 100000}` }, "b");
  check("near watch-list name referred to a person", /person is checking/i.test(r2.text));
  check("no tipping off: the applicant sees nothing about screening", !/screen|watch|sanction|list/i.test(r2.text));
  const app2 = await findApp("Zarak Khanzad");
  check("referral carries the two-person rule", app2 && app2.state === "REFERRED" && app2.two_person_rule);

  // 3. The applicant's token can only complete its own application.
  const start = await fetch(`${API}/v1/onboarding/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
    full_name: "Scope Probe", date_of_birth: "1995-01-01", mobile: "+923001234567", username: `scope.p${Date.now() % 100000}`,
    password: "a-long-test-password", accept_terms: true, biometric_consent: true }) }).then((r) => r.json());
  const probe = await fetch(`${API}/v1/wallet`, { headers: { authorization: `Bearer ${start.onboarding_token}` } });
  check("applicant token is refused outside onboarding", probe.status === 403);

  // 4. Mission Control: Kanz recommends, cannot confirm his own, Harris confirms; the phone updates by itself.
  const c = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await c.goto(`${WEB}/control`); await c.evaluate(() => { localStorage.clear(); localStorage.setItem("paya.operator", "kanz.compliance"); });
  await c.goto(`${WEB}/control/kyc?app=${app2.ref}`); await c.waitForTimeout(1800);
  await c.screenshot({ path: `${OUT}/b-6-console-review.png` });
  const decide = async (btn) => { await c.getByRole("button", { name: btn }).click(); await c.getByLabel(/Reason/).fill("Reviewed evidence: different date of birth from the list entry"); await c.getByRole("dialog").last().getByRole("button", { name: "Approve" }).click(); await c.waitForTimeout(1500); };
  await decide("Recommend approval");
  await decide(/Confirm approval/);
  let st = (await api("taha.audit", `/v1/kyc/applications/${app2.ref}`)).body;
  check("same officer cannot confirm their own recommendation (server refusal)", st.state === "REFERRED" && st.recommended_by === "kanz.compliance");
  await c.screenshot({ path: `${OUT}/b-7-two-person-refused.png` });
  for (let i = 0; i < 5 && await c.getByRole("dialog").count(); i++) { await c.keyboard.press("Escape"); await c.waitForTimeout(250); }
  await c.locator('button[aria-haspopup="menu"]').click(); await c.getByRole("menuitemradio", { name: /Harris/ }).click(); await c.waitForTimeout(1200);
  await c.goto(`${WEB}/control/kyc?app=${app2.ref}`); await c.waitForTimeout(1500);
  await decide(/Confirm approval/);
  st = (await api("taha.audit", `/v1/kyc/applications/${app2.ref}`)).body;
  check("second officer confirms: approved by two different people", st.state === "APPROVED" && st.decided_by === "harris.compliance");
  const flipped = await z.waitForFunction(() => /wallet is open/i.test(document.body.innerText), null, { timeout: 15000 }).then(() => true).catch(() => false);
  check("the waiting phone updates by itself when the officers decide", flipped);
  await z.screenshot({ path: `${OUT}/b-8-phone-approved.png` });
  const rec = (await api("taha.audit", "/v1/audit/log?action=KYC_RECOMMEND_APPROVE")).body;
  const appr = (await api("taha.audit", "/v1/audit/log?action=KYC_APPROVE")).body;
  const refused = (await api("taha.audit", "/v1/audit/log?outcome=DENIED")).body;
  check("both officers' decisions, and the refused self-confirmation, are in the hash-chained audit log",
    rec.items.some((x) => x.actor === "kanz.compliance") && appr.items.some((x) => x.actor === "harris.compliance")
    && refused.items.some((x) => x.actor === "kanz.compliance") && appr.chain_intact === true,
    `chain intact: ${appr.chain_intact}`);

  await b.close();
  const failed = results.filter((x) => !x.ok).length;
  say(`\n${results.length - failed}/${results.length} checks passed`);
  fs.writeFileSync(LOG, lines.join("\n") + "\n");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); fs.writeFileSync(LOG, lines.join("\n") + `\nERROR ${e.message}\n`); process.exit(1); });
