// End-to-end onboarding run in a real browser against the real API and the real face models.
//
// The phone's camera is replaced by a canvas that draws a DRAWN, entirely synthetic face (no real person).
// The face turns when the app asks it to, so the real YuNet landmarks and SFace match are exercised.
//
//   node docs/architecture/tools/kyc_e2e.cjs   (API on :8000 with models, web preview on :4173)
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");

const WEB = process.env.PAYA_WEB || "http://localhost:4173";
const OUT = path.join(__dirname, "../../../evidence/screenshots/kyc");
fs.mkdirSync(OUT, { recursive: true });

const FAKE_CAMERA = () => {
  window.__turn = 0;
  const c = document.createElement("canvas");
  c.width = 640; c.height = 480;
  const g = c.getContext("2d");
  let t = 0;
  const draw = () => {
    t += 1;
    const turn = window.__turn;
    g.filter = "none";
    g.fillStyle = "rgb(220,210,200)"; g.fillRect(0, 0, 640, 480);
    g.save(); g.translate(120, 40); g.filter = "blur(2px)";
    const ell = (x, y, rx, ry, color, fill = true, from = 0, to = Math.PI * 2, lw = 5) => {
      g.beginPath(); g.ellipse(x, y, rx, ry, 0, from, to);
      if (fill) { g.fillStyle = color; g.fill(); } else { g.strokeStyle = color; g.lineWidth = lw; g.stroke(); }
    };
    ell(200, 210, 110, 140, "rgb(215,170,140)");
    for (const side of [-1, 1]) {
      const ex = 200 + side * 45 + turn * 12;
      ell(ex, 180, 22, 12, "#fff");
      ell(ex + turn * 6, 180, 9, 9, "rgb(30,30,40)");
      g.strokeStyle = "rgb(70,50,50)"; g.lineWidth = 5; g.beginPath(); g.moveTo(ex - 25, 155); g.lineTo(ex + 25, 152); g.stroke();
    }
    const nx = 200 + turn * 45;
    g.strokeStyle = "rgb(170,120,100)"; g.lineWidth = 3; g.beginPath(); g.moveTo(nx, 190); g.lineTo(nx - 15, 255); g.lineTo(nx + 15, 255); g.closePath(); g.stroke();
    ell(200 + turn * 22, 295, 40, 15, "rgb(160,60,60)", false, 0, Math.PI);
    g.restore();
    g.fillStyle = `rgba(0,0,0,${0.02 + (t % 7) / 400})`; g.fillRect(0, 470, 640, 10); // frames differ slightly
    requestAnimationFrame(draw);
  };
  draw();
  const stream = c.captureStream(20);
  navigator.mediaDevices.getUserMedia = async () => stream.clone(); // like a real camera: a fresh stream each time
};

async function phone(browser) {
  const ctx = await browser.newContext({
    ...devices["iPhone 13"], permissions: ["geolocation", "camera"],
    geolocation: { latitude: 31.5204, longitude: 74.3587, accuracy: 40 },
  });
  await ctx.addInitScript(FAKE_CAMERA);
  return ctx.newPage();
}

async function onboard(p, who, tag) {
  await p.goto(`${WEB}/app`);
  await p.evaluate(() => localStorage.clear());
  await p.goto(`${WEB}/app`);
  await p.getByText("Open a new Paya wallet").click();
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/${tag}-1-intro.jpg`, quality: 80 });
  await p.getByText("I agree to the Paya prototype terms").click();
  await p.getByText("I agree to Paya processing my photos").click();
  await p.getByRole("button", { name: /Let's go/ }).click();
  await p.getByPlaceholder("Hira Qureshi").fill(who.name);
  await p.locator('input[type="date"]').fill(who.dob);
  await p.getByPlaceholder("0300 1234567").fill("0300 5550199");
  await p.getByPlaceholder("hira.q").fill(who.username);
  await p.getByPlaceholder("10+ characters").fill("demo-password-2026");
  await p.screenshot({ path: `${OUT}/${tag}-2-details.jpg`, quality: 80 });
  await p.getByRole("button", { name: /Continue/ }).click();
  await p.getByRole("button", { name: /Take photo/ }).waitFor();
  await p.waitForTimeout(1200);
  await p.getByRole("button", { name: /Take photo/ }).click();
  await p.getByRole("button", { name: /Check my card/ }).waitFor();
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}/${tag}-3-card.jpg`, quality: 80 });
  await p.getByRole("button", { name: /Check my card/ }).click();
  await p.getByRole("button", { name: /Start/ }).waitFor({ timeout: 15000 });
  await p.waitForTimeout(900);
  await p.getByRole("button", { name: /^Start$/ }).click();
  // follow the on-screen instructions with the drawn face
  const deadline = Date.now() + 20000;
  let shot = false;
  while (Date.now() < deadline) {
    const text = await p.locator("body").innerText();
    const turn = /turn your head to your left/i.test(text) ? 1 : /turn your head to your right/i.test(text) ? -1 : 0;
    await p.evaluate((v) => { window.__turn = v; }, turn);
    if (turn !== 0 && !shot) { await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/${tag}-4-liveness.jpg`, quality: 80 }); shot = true; }
    if (/wallet is open|person is checking|Try again/i.test(text)) break;
    await p.waitForTimeout(120);
  }
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/${tag}-5-result.jpg`, quality: 80 });
  return (await p.locator("body").innerText());
}

(async () => {
  const browser = await chromium.launch();
  const results = [];
  // 1. a clean applicant: every check passes, the wallet opens automatically
  const a = await phone(browser);
  const t1 = await onboard(a, { name: "Hira Qureshi", dob: "1999-05-02", username: `hira.${Date.now() % 100000}` }, "a");
  results.push(["clean applicant auto-approved", /wallet is open/i.test(t1)]);
  await a.getByRole("button", { name: /Start using Paya/ }).click();
  await a.waitForTimeout(2500);
  await a.screenshot({ path: `${OUT}/a-6-wallet.jpg`, quality: 80 });
  results.push(["new wallet shows synthetic Rs 5,000", /5,000/.test(await a.locator("body").innerText())]);

  // 2. a near watch-list name: referred, two officers needed, applicant told nothing about screening
  const b = await phone(browser);
  const t2 = await onboard(b, { name: "Zarak Khanzad", dob: "1990-02-14", username: `zarak.k${Date.now() % 100000}` }, "b");
  results.push(["near watch-list name referred", /person is checking/i.test(t2)]);
  results.push(["no tipping off on the phone", !/screen|watch|sanction/i.test(t2)]);
  const mc = await (await browser.newContext({ viewport: { width: 1720, height: 1000 }, deviceScaleFactor: 1 })).newPage();
  await mc.goto(`${WEB}/control`);
  await mc.getByText("Two-person rule").waitFor({ timeout: 15000 });
  await mc.waitForTimeout(1500);
  await mc.screenshot({ path: `${OUT}/b-6-mission-control-referral.jpg`, quality: 80 });
  await mc.getByRole("button", { name: "Approve as Hamza" }).first().click();
  await mc.getByText(/recommended approval/).waitFor({ timeout: 8000 });
  await mc.getByRole("button", { name: "Confirm as Nadia" }).first().click();
  await mc.waitForTimeout(2500);
  await mc.screenshot({ path: `${OUT}/b-7-mission-control-decided.jpg`, quality: 80 });
  await b.getByText(/wallet is open/i).waitFor({ timeout: 15000 });
  await b.screenshot({ path: `${OUT}/b-8-approved-after-review.jpg`, quality: 80 });
  results.push(["phone updates after the second officer approves", true]);

  await browser.close();
  const failed = results.filter(([, ok]) => !ok);
  for (const [name, ok] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
