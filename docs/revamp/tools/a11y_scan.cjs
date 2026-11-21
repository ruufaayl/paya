// Automated accessibility scan (axe-core, WCAG 2.0/2.1/2.2 A and AA rules) of the main wallet and console screens.
//   AXE=path/to/axe.min.js node docs/revamp/tools/a11y_scan.cjs   (API :8000, web :5173)
const { chromium, devices } = require("playwright");
const fs = require("fs");
const path = require("path");
const WEB = process.env.PAYA_WEB || "http://localhost:5173";
const AXE = fs.readFileSync(process.env.AXE, "utf8");
const out = [];
async function scan(page, name) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => (window).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } }));
  const v = r.violations.map((x) => ({ id: x.id, impact: x.impact, nodes: x.nodes.length, help: x.help, sample: x.nodes[0]?.target?.join(" ") }));
  out.push({ screen: name, violations: v });
  console.log(`${name}: ${v.length} violation types${v.length ? " -> " + v.map((x) => `${x.id}(${x.nodes})`).join(", ") : ""}`);
}
(async () => {
  const b = await chromium.launch();
  const ph = await (await b.newContext({ ...devices["iPhone 13"] })).newPage();
  await ph.goto(`${WEB}/app`); await ph.evaluate(() => localStorage.clear()); await ph.goto(`${WEB}/app`); await ph.waitForTimeout(800);
  await scan(ph, "wallet: sign in");
  await ph.getByText("Sara Ahmed", { exact: true }).click(); await ph.waitForTimeout(1500); await scan(ph, "wallet: home");
  await ph.goto(`${WEB}/app/activity`); await ph.waitForTimeout(1000); await scan(ph, "wallet: activity");
  await ph.goto(`${WEB}/app/account`); await ph.waitForTimeout(1000); await scan(ph, "wallet: account");
  await ph.goto(`${WEB}/app/green`); await ph.waitForTimeout(1500); await scan(ph, "wallet: green");
  await ph.goto(`${WEB}/app/services`); await ph.waitForTimeout(1500); await scan(ph, "wallet: services");
  await ph.goto(`${WEB}/app/services/BAZAAR`); await ph.waitForTimeout(1200); await scan(ph, "wallet: service (shop)");
  await ph.goto(`${WEB}/app/sandbox`); await ph.waitForTimeout(1500); await scan(ph, "wallet: stablecoin sandbox");
  await ph.goto(`${WEB}/app/assistant`); await ph.waitForTimeout(1000); await scan(ph, "wallet: assistant");
  await ph.goto(`${WEB}/app/open`); await ph.waitForTimeout(800); await scan(ph, "wallet: onboarding intro");
  const c = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await c.goto(`${WEB}/control`); await c.evaluate(() => { localStorage.clear(); localStorage.setItem("paya.operator", "auditor"); }); 
  for (const [r, n] of [["", "overview"], ["/transactions", "transactions"], ["/cases", "cases"], ["/kyc", "kyc"], ["/recon", "recon"], ["/events", "events"], ["/audit", "audit"], ["/rail-lab", "rail lab"], ["/ai", "ai operations"], ["/green", "green banking"], ["/partners", "partners"], ["/sandbox", "stablecoin sandbox"], ["/security", "security"]]) {
    await c.goto(`${WEB}/control${r}`); await c.waitForTimeout(1500); await scan(c, `console: ${n}`);
  }
  await b.close();
  fs.writeFileSync(path.join(__dirname, "../../../evidence/revamp/a11y-axe.json"), JSON.stringify(out, null, 2));
})();
