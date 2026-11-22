// MFA and token revocation in a real browser (ADR-017). Codes are computed here from the key shown on
// screen, exactly as an authenticator app would (RFC 6238). Two phases, each on a fresh database:
//   PHASE=optin   server in demo mode (MFA opt-in): enrol, sign in with a code, wrong code refused,
//                 "sign out everywhere else" ends another browser, admin ends sessions, wallet sign-out
//   PHASE=enforced server with PAYA_MFA_ENFORCED=true: password alone gives no access; staff set up an
//                 authenticator before the console opens; customers unaffected
const { chromium, devices } = require("playwright");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const WEB = process.env.PAYA_WEB || "http://localhost:5173";
const API = process.env.PAYA_API || "http://localhost:8000";
const PHASE = process.env.PHASE || "optin";
const OUT = path.join(__dirname, "../../../evidence/screenshots/security");
const RES = path.join(__dirname, "../../../evidence/revamp/mfa-e2e.json");
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (n, ok, note = "") => { results.push({ phase: PHASE, n, ok: !!ok, note }); console.log(`${ok ? "PASS" : "FAIL"}  [${PHASE}] ${n}${note ? `  (${note})` : ""}`); };

function b32(s) { const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = ""; for (const c of s.replace(/[\s=]/g, "").toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, "0"); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function totp(secret, at = Date.now() / 1000) { const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(at / 30))); const mac = crypto.createHmac("sha1", b32(secret)).update(ctr).digest(); const o = mac[mac.length - 1] & 15; return String((mac.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0"); }
const nextCode = (s) => totp(s, Date.now() / 1000 + 30);      // valid (one step of drift) and not yet used
async function rawLogin(u) { const r = await fetch(`${API}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: "paya-demo-2026" }) }); return r.json(); }
async function me(tok) { return (await fetch(`${API}/v1/me`, { headers: { authorization: `Bearer ${tok}` } })).status; }
async function console_(b) { const c = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); await c.goto(`${WEB}/control`); await c.evaluate(() => localStorage.clear()); await c.goto(`${WEB}/control`); return c; }
async function pick(c, name) { await c.getByRole("button", { name: new RegExp(name) }).first().click(); }

(async () => {
  const b = await chromium.launch();
  if (PHASE === "optin") {
    // 1. Kanz turns on two-step verification from the Security page
    const c = await console_(b);
    await pick(c, "Kanz"); await c.waitForTimeout(1500);
    await c.goto(`${WEB}/control/security`); await c.waitForTimeout(1200);
    await c.getByRole("button", { name: "Turn on two-step verification" }).click();
    const secret = (await c.getByTestId("mfa-secret").innerText()).replace(/\s/g, "");
    await c.screenshot({ path: `${OUT}/1-enrol.png` });
    await c.getByLabel(/6-digit code/).fill(totp(secret)); await c.getByRole("button", { name: "Confirm" }).click(); await c.waitForTimeout(1500);
    check("enrolled from the Security page", /Signing in as kanz.compliance needs a code/.test(await c.locator("main").innerText()));
    // 2. The password alone no longer opens anything
    const r = await rawLogin("kanz.compliance");
    check("password alone returns a challenge, not an access token", r.mfa_required && !r.access_token && (await me(r.challenge)) === 401);
    // 3. Sign in through the console: wrong code refused, right code accepted
    await c.getByRole("button", { name: /Kanz/ }).first().click(); await c.getByRole("menu").getByRole("button", { name: "Sign out" }).click(); await c.waitForTimeout(800);
    await pick(c, "Kanz"); await c.waitForTimeout(800);
    await c.getByLabel(/6-digit code/).fill("000000"); await c.getByRole("button", { name: "Verify" }).click(); await c.waitForTimeout(800);
    check("wrong code refused in the console", /not valid/.test(await c.getByRole("dialog").innerText()));
    await c.screenshot({ path: `${OUT}/2-code-prompt.png` });
    await c.getByLabel(/6-digit code/).fill(nextCode(secret)); await c.getByRole("button", { name: "Verify" }).click(); await c.waitForTimeout(2000);
    check("right code opens Mission Control", /Overview|Cases/.test(await c.locator("nav").innerText()));
    // 4. "Sign out everywhere else" ends a second browser's session, and it does not silently come back
    const c2 = await console_(b);
    await pick(c2, "Kanz"); await c2.waitForTimeout(800);
    // The last code used was one step ahead; like a person, wait for the authenticator's next code.
    await new Promise((res) => setTimeout(res, (30 - ((Date.now() / 1000) % 30)) * 1000 + 1000));
    await c2.getByLabel(/6-digit code/).fill(nextCode(secret)); await c2.getByRole("button", { name: "Verify" }).click(); await c2.waitForTimeout(1500);
    await c.goto(`${WEB}/control/security`); await c.waitForTimeout(1200);
    await c.screenshot({ path: `${OUT}/3-sessions.png` });
    await c.getByRole("button", { name: "Sign out everywhere else" }).click(); await c.waitForTimeout(1000);
    await c2.getByRole("link", { name: /Cases & approvals/ }).click(); await c2.waitForTimeout(2500);   // in-app navigation
    const ended = await c2.getByRole("dialog").innerText().catch(() => "");
    check("the other browser is told its session was ended (no silent re-login)", /Your session was ended/.test(ended) && /signed out everywhere else/.test(ended));
    await c2.screenshot({ path: `${OUT}/4-session-ended.png` });
    await c2.reload(); await c2.waitForTimeout(2000);                                                   // and after a reload
    const afterReload = await c2.locator("body").innerText();
    check("after a reload: still not signed in (asks for a code again)", /Verification code|Who is operating\?/.test(afterReload) && !/Cases & approvals/.test(afterReload));
    // 5. Administrator ends a person's sessions, with a reason in the audit chain
    const victim = (await rawLogin("mudaser.ops")).access_token;
    await c.getByRole("button", { name: /Kanz/ }).first().click(); await c.getByRole("menuitemradio", { name: /^Admin/ }).first().click(); await c.waitForTimeout(1500);
    await c.goto(`${WEB}/control/security`); await c.waitForTimeout(1500);
    const row = c.getByRole("row", { name: /sana\.ops/ });
    await row.getByRole("button", { name: "End sessions" }).click();
    await c.getByLabel("Reason (goes into the audit log)").fill("laptop reported stolen");
    await c.getByRole("dialog").getByRole("button", { name: "End sessions" }).click(); await c.waitForTimeout(1200);
    check("admin ends Mudaser's sessions: her token stops at once", (await me(victim)) === 401);
    check("staff table shows Kanz's two-step verification on", /hamza\.compliance\s*COMPLIANCE\s*on/.test(await c.locator("main").innerText()));
    await c.screenshot({ path: `${OUT}/5-admin.png` });
    // 6. Wallet sign-out ends the token on the server
    const w = await (await b.newContext({ ...devices["iPhone 13"] })).newPage();
    await w.goto(`${WEB}/app`); await w.evaluate(() => localStorage.clear()); await w.goto(`${WEB}/app`);
    await w.getByText("Sara Ahmed", { exact: true }).click(); await w.waitForTimeout(1200);
    const tok = await w.evaluate(() => JSON.parse(localStorage.getItem("paya.sessions") || "{}").sara?.token);
    await w.goto(`${WEB}/app/account`); await w.waitForTimeout(800);
    await w.getByRole("button", { name: /Sign out/ }).click(); await w.waitForTimeout(1200);
    check("wallet sign-out revokes the token on the server", tok && (await me(tok)) === 401);
  } else {
    const r = await rawLogin("rufayl.finance");
    check("enforced: staff password alone yields only a set-up challenge", r.mfa_setup_required && !r.access_token);
    const c = await console_(b);
    await pick(c, "Rufayl"); await c.waitForTimeout(1500);
    const secret = (await c.getByTestId("mfa-secret").innerText()).replace(/\s/g, "");
    await c.screenshot({ path: `${OUT}/6-enforced-setup.png` });
    await c.getByLabel(/6-digit code/).fill(totp(secret)); await c.getByRole("button", { name: "Confirm and sign in" }).click(); await c.waitForTimeout(2000);
    check("enforced: console opens only after the authenticator is set up", /Reconciliation/.test(await c.locator("nav").innerText()));
    const cust = await rawLogin("sara");
    check("enforced: customers are not affected", !!cust.access_token);
  }
  await b.close();
  const prev = fs.existsSync(RES) ? JSON.parse(fs.readFileSync(RES, "utf8")).results.filter((x) => x.phase !== PHASE) : [];
  const all = [...prev, ...results];
  const failed = all.filter((x) => !x.ok).length;
  fs.writeFileSync(RES, JSON.stringify({ at: new Date().toISOString(), passed: all.length - failed, failed, results: all }, null, 2));
  console.log(`${results.length - results.filter((x) => !x.ok).length}/${results.length} checks passed (${PHASE}); ${all.length - failed}/${all.length} overall`);
  process.exit(results.some((x) => !x.ok) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
