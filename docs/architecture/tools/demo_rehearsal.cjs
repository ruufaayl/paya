// Automated rehearsal of the 8-10 minute technical demo (docs/demo/demo-script.md).
// Drives two emulated iPhones (cashier + customer) and Mission Control against the real stack,
// asserts every outcome the presenter will claim, times each scene and saves a screenshot per scene.
//
//   make up                                   # API on :8000
//   cd web && npm run build && npx vite preview --port 4173
//   node docs/architecture/tools/demo_rehearsal.cjs
//
// Writes evidence/demo/rehearsal-<date>.md and evidence/demo/scene-*.png
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const WEB = process.env.WEB || 'http://localhost:4173';
const API = process.env.API || 'http://localhost:8000';
const OUT = path.resolve(__dirname, '../../../evidence/demo');
fs.mkdirSync(OUT, { recursive: true });
const scenes = [];
const pageErrors = [];

async function api(pathname, { as, method = 'GET', body } = {}) {
  const tok = (await (await fetch(`${API}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: as, password: 'paya-demo-2026' }) })).json()).access_token;
  const r = await fetch(`${API}${pathname}`, { method, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

async function scene(name, fn) {
  const t = Date.now();
  const checks = [];
  const check = (label, ok) => { checks.push({ label, ok: !!ok }); if (!ok) console.log('  FAIL:', label); };
  try { await fn(check); } catch (e) { checks.push({ label: `error: ${e.message.split('\n')[0]}`, ok: false }); }
  const s = { name, seconds: (Date.now() - t) / 1000, checks };
  scenes.push(s);
  console.log(`${checks.every(c => c.ok) ? 'PASS' : 'FAIL'}  ${name}  (${s.seconds.toFixed(1)} s)`);
}

(async () => {
  const browser = await chromium.launch();
  const watch = (p, n) => p.on('pageerror', e => pageErrors.push(`${n}: ${e.message}`));
  const desk = await browser.newContext({ viewport: { width: 1680, height: 940 } });
  const mc = await desk.newPage(); watch(mc, 'control');
  const phoneA = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage(); watch(phoneA, 'cashier');
  const phoneB = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage(); watch(phoneB, 'customer');
  await api('/v1/chaos/rail', { as: 'admin', method: 'POST', body: { mode: 'NORMAL' } });

  await scene('0. Set-up: Mission Control live, two phones signed in', async (check) => {
    await mc.goto(`${WEB}/control`);
    check('Mission Control shows LIVE', await mc.waitForSelector('text=LIVE', { timeout: 15000 }));
    await phoneA.goto(`${WEB}/app`); await phoneA.click('text=Chai Junction till');
    check('cashier till open', await phoneA.waitForSelector('text=New sale'));
    await phoneB.goto(`${WEB}/app`); await phoneB.click('text=Verified, Tier 2 wallet');
    check('customer wallet open', await phoneB.waitForSelector('text=Available balance'));
  });

  await scene('1. Normal payment: QR -> slide to pay -> PAID only after Raast', async (check) => {
    for (const k of ['2', '4', '5', '0']) await phoneA.click(`button:has-text("${k}") >> nth=0`);
    await phoneA.click('text=Show Raast QR'); await phoneA.waitForTimeout(500);
    await phoneB.goto(`${WEB}/app/scan`); await phoneB.click('text=Chai Junction');
    await phoneB.waitForSelector('text=Slide to pay');
    const k = await phoneB.locator('.cursor-grab').boundingBox();
    await phoneB.mouse.move(k.x + 20, k.y + 20); await phoneB.mouse.down();
    for (let i = 1; i <= 20; i++) await phoneB.mouse.move(k.x + 20 + i * 16, k.y + 20);
    await phoneB.mouse.up();
    await mc.waitForTimeout(400); await mc.screenshot({ path: `${OUT}/scene-1-control.png` });
    check('customer sees Paid', await phoneB.waitForSelector('h2:has-text("Paid")', { timeout: 15000 }));
    check('till shows PAID', await phoneA.waitForSelector('text=PAID', { timeout: 15000 }));
    await phoneA.screenshot({ path: `${OUT}/scene-1-till.png` });
    const ref = (await phoneB.locator('p.font-mono').first().textContent()).trim();
    const d = (await api(`/v1/transactions/${ref}`, { as: 'auditor' })).data;
    check('ledger shows AUTH_POST + SETTLE + FEE', JSON.stringify(d.ledger.map(j => j.posting_type).sort()) === '["AUTH_POST","FEE","SETTLE"]');
  });

  await scene('2. Lost reply + customer retry: no double debit, recovery by enquiry', async (check) => {
    const before = (await api('/v1/wallet', { as: 'sara' })).data.ledger_balance.minor;
    await mc.click('text=Lost reply'); await mc.waitForTimeout(300);
    await mc.selectOption('select', 'sara'); await mc.fill('input[type=number]', '800'); await mc.click('text=Pay + retry');
    check('toast proves replay', await mc.waitForSelector('text=replayed: true', { timeout: 10000 }));
    await mc.screenshot({ path: `${OUT}/scene-2-control.png` });
    await mc.click('text=Healthy');
    await mc.click('text=Ask rail about pending payments'); await mc.waitForTimeout(1500);
    const after = (await api('/v1/wallet', { as: 'sara' })).data;
    check('exactly one debit of Rs 800', before - after.ledger_balance.minor === 80000);
    check('payment settled after enquiry', after.transactions[0].status === 'SETTLED');
  });

  await scene('3. Watch-list hold -> human gate -> denied cashier -> compliance release', async (check) => {
    await mc.selectOption('select', 'zarak'); await mc.fill('input[type=number]', '600'); await mc.click('text=Pay now');
    check('hold card appears', await mc.waitForSelector('text=COMPLIANCE HOLD', { timeout: 10000 }));
    await mc.screenshot({ path: `${OUT}/scene-3-gate.png` });
    await mc.click('text=Cashier tries finance action');
    check('denial toast shown', await mc.waitForSelector('text=FORBIDDEN', { timeout: 5000 }));
    const held = (await api('/v1/wallet', { as: 'zarak' })).data.transactions.find(t => t.status === 'UNDER_REVIEW');
    const card = mc.locator('div.rounded-2xl', { hasText: held.txn_ref }).filter({ hasText: 'COMPLIANCE HOLD' }).first();
    await card.locator('button', { hasText: 'Release as Hamza' }).click(); await mc.waitForTimeout(1500);
    const z = (await api(`/v1/transactions/${held.txn_ref}`, { as: 'auditor' })).data;
    check(`released payment ${held.txn_ref} settled`, z.status === 'SETTLED');
    const v = (await api('/v1/audit/verify', { as: 'auditor' })).data;
    check('audit chain intact', v.chain_intact === true);
  });

  await scene('4. Raast outage: circuit breaker refuses before taking money', async (check) => {
    const w0 = (await api('/v1/wallet', { as: 'omar' })).data;
    const seen = new Set(w0.transactions.map(t => t.txn_ref));
    await mc.click('text=Outage');
    await mc.selectOption('select', 'omar'); await mc.fill('input[type=number]', '50');
    for (let i = 0; i < 4; i++) { await mc.click('text=Pay now'); await mc.waitForTimeout(700); }
    check('RAIL_UNAVAILABLE shown', await mc.waitForSelector('text=RAIL_UNAVAILABLE', { timeout: 8000 }));
    await mc.screenshot({ path: `${OUT}/scene-4-outage.png` });
    await mc.click('text=Healthy'); await mc.click('text=Ask rail about pending payments'); await mc.waitForTimeout(2000);
    const w1 = (await api('/v1/wallet', { as: 'omar' })).data;
    const fresh = w1.transactions.filter(t => !seen.has(t.txn_ref) && t.type === 'PAYMENT');
    const debited = w0.ledger_balance.minor - w1.ledger_balance.minor;
    check(`only payments accepted before the breaker opened exist (${fresh.length} of 4 attempts)`, fresh.length < 4);
    check('each accepted payment recovered and settled', fresh.length > 0 && fresh.every(t => t.status === 'SETTLED'));
    check('money taken equals settled payments only (refused attempts took nothing)', debited === fresh.length * 5000);
  });

  await scene('5. Reconciliation break -> AI suggestion -> human accepts and resolves; duplicate file refused', async (check) => {
    await mc.click('text=Missing line'); await mc.selectOption('select', 'omar'); await mc.fill('input[type=number]', '450');
    await mc.click('text=Pay now'); await mc.waitForTimeout(1000); await mc.click('text=Healthy');
    await mc.click('text=Run reconciliation (Rabia)');
    check('AI suggestion appears', await mc.waitForSelector('text=AI triage suggests', { timeout: 20000 }));
    await mc.screenshot({ path: `${OUT}/scene-5-ai.png` });
    await mc.locator('button', { hasText: 'Accept as Sana' }).first().click(); await mc.waitForTimeout(800);
    await mc.locator('button', { hasText: 'Resolve as Sana' }).first().click(); await mc.waitForTimeout(800);
    await mc.click('text=Import same file again');
    check('duplicate file refused', await mc.waitForSelector('text=DUPLICATE_SETTLEMENT_FILE', { timeout: 8000 }));
    const integ = (await api('/v1/finance/integrity', { as: 'rabia.finance' })).data;
    const fails = integ.checks.filter(c => c.status === 'FAIL').map(c => c.check);
    check(`integrity has no FAIL (got: ${fails.join(',') || 'none'})`, fails.length === 0);
    const tb = (await api('/v1/finance/trial-balance', { as: 'rabia.finance' })).data;
    check('trial balance balanced', tb.balanced === true);
    await mc.screenshot({ path: `${OUT}/scene-5-resolved.png` });
  });

  await browser.close();
  const total = scenes.reduce((a, s) => a + s.seconds, 0);
  const allOk = scenes.every(s => s.checks.every(c => c.ok)) && pageErrors.length === 0;
  const md = [`# Demo rehearsal - ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, '',
    `Automated run of [docs/demo/demo-script.md](../../docs/demo/demo-script.md) against the Compose stack, with two emulated iPhones and Mission Control. **Result: ${allOk ? 'ALL CHECKS PASSED' : 'FAILURES - see below'}.**`, '',
    `Machine time ${total.toFixed(0)} s. Presenter time is planned at 8-10 min (the script budgets narration per scene).`, '',
    '| Scene | Machine time | Checks |', '|---|---:|---|',
    ...scenes.map(s => `| ${s.name} | ${s.seconds.toFixed(1)} s | ${s.checks.map(c => `${c.ok ? 'PASS' : '**FAIL**'} ${c.label}`).join('<br>')} |`), '',
    `Browser errors: ${pageErrors.length ? pageErrors.join('; ') : 'none'}.`];
  fs.writeFileSync(path.join(OUT, `rehearsal-${new Date().toISOString().slice(0, 10)}.md`), md.join('\n') + '\n');
  console.log(allOk ? '\nREHEARSAL PASSED' : '\nREHEARSAL HAD FAILURES');
  process.exit(allOk ? 0 : 1);
})();
