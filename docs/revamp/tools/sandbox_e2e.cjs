// Theme 5 browser run: the stablecoin sandbox. Run twice against a fresh database:
//   PHASE=off  - server started WITHOUT PAYA_STABLECOIN_SANDBOX: nothing is reachable or shown
//   PHASE=on   - server started with PAYA_STABLECOIN_SANDBOX=true: enrol, faucet, finality, merchant payment,
//                screening block, chain outage, reconciliation, rupee balance untouched
//   PHASE=off node docs/revamp/tools/sandbox_e2e.cjs ; PHASE=on node docs/revamp/tools/sandbox_e2e.cjs
const { chromium, devices } = require("playwright");
const fs = require("fs");
const path = require("path");
const WEB = process.env.PAYA_WEB || "http://localhost:5173";
const API = process.env.PAYA_API || "http://localhost:8000";
const PHASE = process.env.PHASE || "on";
const OUT = path.join(__dirname, "../../../evidence/screenshots/sandbox");
const RES = path.join(__dirname, "../../../evidence/revamp/sandbox-e2e.json");
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (n, ok, note = "") => { results.push({ phase: PHASE, n, ok: !!ok, note }); console.log(`${ok ? "PASS" : "FAIL"}  [${PHASE}] ${n}${note ? `  (${note})` : ""}`); };
const tokens = {};
async function token(u) { if (!tokens[u]) { const r = await fetch(`${API}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: "paya-demo-2026" }) }); tokens[u] = (await r.json()).access_token; } return tokens[u]; }
async function api(u, p, init = {}) { const r = await fetch(`${API}${p}`, { ...init, headers: { authorization: `Bearer ${await token(u)}`, "content-type": "application/json", ...(init.headers || {}) } }); return { status: r.status, body: await r.json() }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 20000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(500); } return false; }

(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 2 })).newPage();
  await p.goto(`${WEB}/app`); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.goto(`${WEB}/app`);
  await p.getByText("Sara Ahmed", { exact: true }).click(); await p.waitForTimeout(1200);
  const c = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await c.goto(`${WEB}/control`); await c.evaluate(() => { localStorage.clear(); localStorage.setItem("paya.operator", "mudaser.ops"); });

  if (PHASE === "off") {
    await p.goto(`${WEB}/app/services`); await p.waitForTimeout(1500);
    check("wallet: no sandbox tile when the server has it off", !/Stablecoin sandbox/.test(await p.locator("main").innerText()));
    const r = await api("sara", "/v1/sandbox/wallet");
    check("API: sandbox endpoints answer FEATURE_DISABLED", r.status === 404 && r.body.error.code === "FEATURE_DISABLED");
    await c.goto(`${WEB}/control/sandbox`); await c.waitForTimeout(1500);
    check("Mission Control: says it is switched off and why", /Switched off on this server/.test(await c.locator("main").innerText()));
    await c.screenshot({ path: `${OUT}/0-console-off.png` });
  } else {
    const rupees0 = (await api("sara", "/v1/wallet")).body.ledger_balance.minor;
    await p.goto(`${WEB}/app/services`); await p.waitForTimeout(1500);
    await p.getByRole("button", { name: /Stablecoin sandbox/ }).click(); await p.waitForTimeout(1200);
    let text = await p.locator("main").innerText();
    check("disclaimer shown before anything else", /Test tokens only/.test(text) && /no value/.test(text));
    await p.getByRole("checkbox").check(); await p.getByRole("button", { name: "Join the sandbox" }).click(); await p.waitForTimeout(1200);
    await p.getByRole("button", { name: "Get test tokens" }).click(); await p.waitForTimeout(800);
    text = await p.locator("main").innerText();
    check("faucet tokens are not counted before finality", /\(simulated\)\s*0 tPKR-TEST/.test(text) && /on the way in/.test(text));
    await p.screenshot({ path: `${OUT}/1-wallet-pending.png` });
    const final = await until(async () => /Confirmed/.test(await p.locator("main").innerText()) && /1,000 tPKR-TEST/.test(await p.locator("main").innerText()));
    check("after 3 confirmations the balance counts", final);

    await p.getByRole("button", { name: "Pay with tokens" }).click();
    await p.getByLabel("Amount (test tokens)").fill("250"); await p.getByRole("button", { name: "Send" }).click(); await p.waitForTimeout(800);
    const tx = (await api("sara", "/v1/sandbox/wallet")).body.transfers[0];
    check("merchant payment submitted as pending, not final", tx.kind === "MERCHANT" && tx.status === "PENDING");
    check("merchant payment becomes final on chain", await until(async () => (await api("sara", "/v1/sandbox/wallet")).body.transfers[0].status === "CONFIRMED"));
    await p.waitForTimeout(1500); await p.screenshot({ path: `${OUT}/2-wallet-final.png`, fullPage: true });

    await p.getByRole("button", { name: "Pay with tokens" }).click();
    await p.getByLabel("Another address").check();
    await p.getByLabel("Address", { exact: true }).fill("0xbad0000000000000000000000000000000000001");
    await p.getByLabel("Amount (test tokens)").fill("50"); await p.getByRole("button", { name: "Send" }).click(); await p.waitForTimeout(1000);
    check("screened address blocked, with a Compliance case", (await api("sara", "/v1/sandbox/wallet")).body.transfers[0].status === "BLOCKED"
      && (await api("kanz.compliance", "/v1/cases")).body.some((x) => x.kind === "TOKEN_SCREENING"));

    await api("mudaser.ops", "/v1/chaos/chain", { method: "POST", body: JSON.stringify({ mode: "DOWN" }) });
    const down = await api("sara", "/v1/sandbox/transfers", { method: "POST", headers: { "Idempotency-Key": `sb-${Date.now()}` }, body: JSON.stringify({ merchant_id: (await api("sara", "/v1/sandbox/wallet")).body.merchants[0].id, amount_units: 10_00 }) });
    check("chain down: transfer recorded as not sent, nothing reserved", down.body.status === "FAILED" && !down.body.chain_tx);
    await api("mudaser.ops", "/v1/chaos/chain", { method: "POST", body: JSON.stringify({ mode: "NORMAL" }) });

    await c.goto(`${WEB}/control/sandbox`); await c.waitForTimeout(2500);
    text = await c.locator("main").innerText();
    check("Mission Control: chain, transfers and reconciliation matched", /Chain height/i.test(text) && /matched/.test(text) && /blocked/.test(text));
    await c.screenshot({ path: `${OUT}/3-console-on.png` });
    const integ = (await api("rufayl.finance", "/v1/finance/integrity")).body.checks;
    check("integrity: chain reconciliation and no tokens in the rupee ledger",
      ["token_transfers_match_chain", "sandbox_tokens_never_in_rupee_ledger", "trial_balance_balanced"].every((w) => integ.find((x) => x.check === w)?.status === "PASS"));
    check("rupee wallet balance unchanged by sandbox activity", (await api("sara", "/v1/wallet")).body.ledger_balance.minor === rupees0);
  }
  await b.close();
  const prev = fs.existsSync(RES) ? JSON.parse(fs.readFileSync(RES, "utf8")).results.filter((r) => r.phase !== PHASE) : [];
  const all = [...prev, ...results];
  const failed = all.filter((x) => !x.ok).length;
  fs.writeFileSync(RES, JSON.stringify({ at: new Date().toISOString(), passed: all.length - failed, failed, results: all }, null, 2));
  console.log(`${results.length - results.filter((x) => !x.ok).length}/${results.length} checks passed (${PHASE}); ${all.length - failed}/${all.length} overall`);
  process.exit(results.some((x) => !x.ok) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
