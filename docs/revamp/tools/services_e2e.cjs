// Theme 4 browser run: the super app. Services hub → pay a bill → the same bill can't be paid twice → Bazaar
// Lane with a merchant-funded offer and a consent prompt → Compliance suspends a partner in Mission Control.
// Real backend, fresh synthetic database.   node docs/revamp/tools/services_e2e.cjs   (API :8000, web :5173)
const { chromium, devices } = require("playwright");
const fs = require("fs");
const path = require("path");
const WEB = process.env.PAYA_WEB || "http://localhost:5173";
const API = process.env.PAYA_API || "http://localhost:8000";
const OUT = path.join(__dirname, "../../../evidence/screenshots/services");
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (n, ok, note = "") => { results.push({ n, ok: !!ok, note }); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${note ? `  (${note})` : ""}`); };
const tokens = {};
async function token(u) { if (!tokens[u]) { const r = await fetch(`${API}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: "paya-demo-2026" }) }); tokens[u] = (await r.json()).access_token; } return tokens[u]; }
async function api(u, p, init = {}) { const r = await fetch(`${API}${p}`, { ...init, headers: { authorization: `Bearer ${await token(u)}`, "content-type": "application/json", ...(init.headers || {}) } }); return { status: r.status, body: await r.json() }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CONSUMER = String(4100000000 + (Date.now() % 99999999)).slice(0, 10);

async function slideToPay(p) {
  await p.waitForURL(/\/app\/pay\//); await p.getByRole("slider").waitFor(); await p.waitForTimeout(600);
  await p.getByRole("slider").focus(); await p.keyboard.press("Enter");
  await p.getByText(/^Paid$/).first().waitFor({ timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(800);
}

(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 2 })).newPage();
  await p.goto(`${WEB}/app`); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.goto(`${WEB}/app`);
  await p.getByText("Sara Ahmed", { exact: true }).click(); await p.waitForTimeout(1200);
  await p.getByRole("link", { name: "Services" }).click(); await p.waitForTimeout(1500);
  let text = await p.locator("main").innerText();
  check("hub lists bills, top-up, shop and takaful, and says investments are not offered",
    /Indus Power/.test(text) && /Raabta Mobile/.test(text) && /Bazaar Lane/.test(text) && /Hifazat Takaful/.test(text) && /Investments: not offered/.test(text));
  await p.screenshot({ path: `${OUT}/1-hub.png` });

  // 1. A bill, through the normal review
  await p.getByRole("button", { name: /Indus Power/ }).click(); await p.waitForTimeout(800);
  await p.getByLabel("Consumer number").fill(CONSUMER);
  await p.getByRole("button", { name: "Find bill" }).click(); await p.waitForTimeout(1000);
  const bill = (await api("sara", "/v1/services/INDUSPOWER/bill-lookup", { method: "POST", body: JSON.stringify({ consumer_no: CONSUMER }) })).body;
  await p.screenshot({ path: `${OUT}/2-bill.png` });
  await p.getByRole("button", { name: /^Pay Rs/ }).click();
  await p.waitForURL(/\/app\/pay\//); await p.waitForTimeout(800);
  text = await p.locator("main").innerText();
  check("bill opens the normal review with the server's amount", /Indus Power/.test(text) && text.includes((bill.amount_minor / 100).toLocaleString("en-PK")), `Rs ${bill.amount_minor / 100}`);
  await slideToPay(p);
  let orders = (await api("sara", "/v1/services/orders")).body;
  check("order is Done only after the payment settled", orders[0].status === "COMPLETED" && orders[0].fulfilment === "Bill paid to the biller" && /SETTLED|RECONCILED/.test(orders[0].payment.status));
  const again = await api("omar", "/v1/services/INDUSPOWER/orders", { method: "POST", body: JSON.stringify({ consumer_no: CONSUMER }) });
  check("the same bill can't be paid twice (another customer refused)", again.status === 409);
  await p.goto(`${WEB}/app/services/INDUSPOWER`); await p.waitForTimeout(800);
  await p.getByLabel("Consumer number").fill(CONSUMER); await p.getByRole("button", { name: "Find bill" }).click(); await p.waitForTimeout(1000);
  check("looking the bill up again says it is already paid", /already paid/.test(await p.locator("main").innerText()));

  // 2. Bazaar Lane: catalogue, offer, consent
  await p.goto(`${WEB}/app/services/BAZAAR`); await p.waitForTimeout(1000);
  await p.getByRole("button", { name: "Add one Basmati rice, 5 kg" }).click();
  await p.getByRole("button", { name: "Add one Reusable jute bag" }).click();
  await p.getByRole("button", { name: /^Continue/ }).click(); await p.waitForTimeout(700);
  text = await p.getByRole("dialog").innerText();
  check("consent asked before the partner receives anything, naming the fields", /your name/.test(text) && /Not shared/.test(text));
  await p.screenshot({ path: `${OUT}/3-consent.png` });
  await p.getByRole("button", { name: "Allow and continue" }).click();
  await p.waitForURL(/\/app\/pay\//); await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/4-bazaar-review.png` });
  await slideToPay(p);
  orders = (await api("sara", "/v1/services/orders")).body;
  const baz = orders.find((o) => o.partner === "BAZAAR");
  check("offer priced by the server: Rs 2,750 less 10% = Rs 2,475", baz && baz.discount_minor === 275_00 && baz.amount_minor === 2_475_00);
  check("partner received only the consented field", baz && JSON.stringify(baz.shared_with_partner) === '["name"]');
  check("shop order Done after settlement", baz && baz.status === "COMPLETED");
  await p.goto(`${WEB}/app/services`); await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/5-orders.png`, fullPage: true });
  await p.setViewportSize({ width: 360, height: 780 }); await p.waitForTimeout(400);
  check("Services fits a 360 px phone", await p.evaluate(() => document.documentElement.scrollWidth <= 360));
  await p.setViewportSize({ width: 390, height: 844 });

  // 3. Third-party risk: Compliance suspends a partner
  const c = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await c.goto(`${WEB}/control`); await c.evaluate(() => { localStorage.clear(); localStorage.setItem("paya.operator", "sana.ops"); });
  await c.goto(`${WEB}/control/partners`); await c.waitForTimeout(1800);
  text = await c.locator("main").innerText();
  check("Ops sees partners and volumes but can't suspend", /Indus Power/.test(text) && /Compliance only/.test(text) && !/Suspend\b/.test(text.replace(/suspended/gi, "")));
  await c.evaluate(() => localStorage.setItem("paya.operator", "hamza.compliance")); await c.reload(); await c.waitForTimeout(1800);
  const row = c.getByRole("row", { name: /Hifazat Takaful/ });
  await row.getByRole("button", { name: "Suspend" }).click();
  await c.getByLabel("Reason (goes into the audit log)").fill("Claims complaints under review");
  await c.getByRole("dialog").getByRole("button", { name: "Suspend" }).click(); await c.waitForTimeout(1500);
  await c.screenshot({ path: `${OUT}/6-console-partners.png` });
  await p.goto(`${WEB}/app/services/HIFAZAT`); await p.waitForTimeout(1200);
  check("suspended partner is unavailable in the wallet", /Temporarily unavailable/.test(await p.locator("main").innerText()));
  const audit = (await api("auditor", "/v1/audit/log?action=PARTNER_SUSPENDED")).body;
  check("suspension recorded in the audit chain with its reason", audit.items[0] && audit.items[0].actor === "hamza.compliance" && audit.chain_intact);
  const integ = (await api("rabia.finance", "/v1/finance/integrity")).body.checks;
  const want = ["service_order_matches_payment_request", "partner_data_shared_only_with_consent", "till_paid_without_settlement", "trial_balance_balanced"];
  check("integrity: order amounts, consented sharing, trial balance", want.every((w) => integ.find((x) => x.check === w)?.status === "PASS"));
  await api("hamza.compliance", "/v1/ops/partners/HIFAZAT/status", { method: "POST", body: JSON.stringify({ status: "ACTIVE", reason: "Review closed, resume" }) });
  await b.close();
  const failed = results.filter((x) => !x.ok).length;
  fs.writeFileSync(path.join(__dirname, "../../../evidence/revamp/services-e2e.json"), JSON.stringify({ at: new Date().toISOString(), passed: results.length - failed, failed, results }, null, 2));
  console.log(`${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
