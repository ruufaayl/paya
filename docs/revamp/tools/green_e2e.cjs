// Theme 2 browser run: Green in the wallet (footprint, green pot, round-ups, offset through the normal Raast
// review) and the Green banking page in Mission Control. Real backend, fresh synthetic database.
//   node docs/revamp/tools/green_e2e.cjs   (API :8000 fresh DB, web :5173)
const { chromium, devices } = require("playwright");
const fs = require("fs");
const path = require("path");
const WEB = process.env.PAYA_WEB || "http://localhost:5173";
const API = process.env.PAYA_API || "http://localhost:8000";
const OUT = path.join(__dirname, "../../../evidence/screenshots/green");
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (n, ok, note = "") => { results.push({ n, ok: !!ok, note }); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${note ? `  (${note})` : ""}`); };
const tokens = {};
async function token(u) { if (!tokens[u]) { const r = await fetch(`${API}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: "paya-demo-2026" }) }); tokens[u] = (await r.json()).access_token; } return tokens[u]; }
async function api(u, p, init = {}) { const r = await fetch(`${API}${p}`, { ...init, headers: { authorization: `Bearer ${await token(u)}`, "content-type": "application/json", ...(init.headers || {}) } }); return { status: r.status, body: await r.json() }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // Two real settled purchases for Sara: Rs 2,450 at Chai Junction (food) and Rs 1,230 at Shifa Pharmacy.
  for (const [cashier, amount] of [["ayesha.cashier", 2450_00], ["kamran.cashier", 1230_00]]) {
    const pr = (await api(cashier, "/v1/payment-requests", { method: "POST", body: JSON.stringify({ amount_minor: amount, order_ref: `GREEN-${amount}-${Date.now()}` }) })).body;
    await api("sara", "/v1/payments", { method: "POST", headers: { "Idempotency-Key": `green-${pr.id}` }, body: JSON.stringify({ payment_request_id: pr.id }) });
  }
  await sleep(2500);
  const wallet0 = (await api("sara", "/v1/wallet")).body.ledger_balance.minor;

  const b = await chromium.launch();
  const p = await (await b.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 2 })).newPage();
  await p.goto(`${WEB}/app`); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.goto(`${WEB}/app`);
  await p.getByText("Sara Ahmed", { exact: true }).click(); await p.waitForTimeout(1200);
  await p.getByRole("button", { name: /^Green/ }).click(); await p.waitForTimeout(1500);
  let text = await p.locator("main").innerText();
  const expected = (2450 * 2.4 + 1230 * 1.1) / 1000;      // the factor table, applied to settled payments only
  check("footprint is labelled an estimate, from settled payments", /Estimate/.test(text) && text.includes(`about ${expected.toFixed(1)} kg`), `${expected.toFixed(2)} kg`);
  check("method and factor set are disclosed", /Not a measurement/.test(text) && /green\.v1/.test(text));
  await p.screenshot({ path: `${OUT}/1-wallet-green.png` });

  await p.getByRole("button", { name: "Add money" }).click();
  await p.getByLabel("Amount (Rs)").fill("5000");
  await p.getByRole("button", { name: /Confirm Rs 5,000/ }).dblclick();   // a double tap must move money once
  await p.waitForTimeout(1500);
  const pot1 = (await api("sara", "/v1/green/pot")).body;
  check("double-tapped deposit moves money once", pot1.balance === 5000_00 && pot1.moves.length === 1, `${pot1.moves.length} move(s)`);
  check("double tap shows no error", !/Something went wrong/.test(await p.locator("body").innerText()));
  check("wallet ledger balance down by exactly the deposit", (await api("sara", "/v1/wallet")).body.ledger_balance.minor === wallet0 - 5000_00);

  text = await p.locator("main").innerText();
  check("round-ups offered from settled payments (Rs 50 + Rs 70)", /Add my round-ups \(Rs 120\)/.test(text));
  await p.getByRole("button", { name: /Add my round-ups/ }).click(); await p.waitForTimeout(700);
  check("dialog is centred on a phone", await p.getByRole("dialog").evaluate((d) => { const r = d.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && Math.abs(r.left - (innerWidth - r.right)) < 2; }));
  await p.getByRole("button", { name: /Confirm Rs 120/ }).click(); await p.waitForTimeout(1500);
  check("round-up deposit booked; no further round-up offered", (await api("sara", "/v1/green/pot")).body.balance === 5120_00 && !/Add my round-ups/.test(await p.locator("main").innerText()));
  await p.screenshot({ path: `${OUT}/2-wallet-pot.png` });

  // Offset: goes through the normal review screen and the Raast path.
  await p.getByRole("button", { name: /^Rs 1,500/ }).click();
  await p.waitForURL(/\/app\/pay\//); await p.getByRole("slider").waitFor(); await p.waitForTimeout(600);
  text = await p.locator("main").innerText();
  check("offset opens the normal payment review", /Indus Delta Mangroves/.test(text));
  await p.screenshot({ path: `${OUT}/3-offset-review.png` });
  await p.getByRole("slider").focus(); await p.keyboard.press("Enter");
  await p.waitForTimeout(4000);
  const offs = (await api("sara", "/v1/green/offsets")).body.items;
  check("certificate recorded only after Raast settles", offs[0] && offs[0].status === "RECORDED" && /^OFS-/.test(offs[0].certificate_ref) && offs[0].kg_offset === 500, offs[0] && offs[0].certificate_ref);
  await p.goto(`${WEB}/app/green`); await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/4-wallet-certificate.png`, fullPage: true });
  const omarSees = await api("omar", "/v1/payment-requests");
  check("offset requests are not offered to other customers", omarSees.body.every((r) => r.kind !== "GREEN_OFFSET"));

  const c = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await c.goto(`${WEB}/control`); await c.evaluate(() => { localStorage.clear(); localStorage.setItem("paya.operator", "mudaser.ops"); });
  await c.goto(`${WEB}/control/green`); await c.waitForTimeout(2000);
  text = await c.locator("main").innerText();
  check("Mission Control shows pot total from ledger 2110 and settled offsets", /Rs 5,120/.test(text) && /Rs 1,500/.test(text) && /ledger 2110/.test(text));
  check("Mission Control shows aggregates only (no customer names)", !/Sara|Ahmed/.test(text));
  await c.screenshot({ path: `${OUT}/5-console-green.png` });
  const integ = (await api("rufayl.finance", "/v1/finance/integrity")).body;
  const g = integ.checks.filter((x) => x.check.includes("green") || x.check === "trial_balance_balanced");
  check("integrity: pots non-negative, one journal per move, trial balance", g.length === 3 && g.every((x) => x.status === "PASS"));
  await b.close();
  const failed = results.filter((x) => !x.ok).length;
  fs.writeFileSync(path.join(__dirname, "../../../evidence/revamp/green-e2e.json"), JSON.stringify({ at: new Date().toISOString(), passed: results.length - failed, failed, results }, null, 2));
  console.log(`${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
