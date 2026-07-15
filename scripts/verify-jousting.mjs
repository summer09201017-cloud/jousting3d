// jousting3d 端到端驗證:完美騎士(綠區出槍)→ 高分勝;全程不出槍 → 低分;搶七模式
// 用法:node scripts/verify-jousting.mjs <url> <outDir>
import { chromium } from "playwright";

const [url, outDir] = process.argv.slice(2);
const EXE = process.env.CHROME_EXE ||
  "C:/Users/agape250/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe";
const errors = [];
const results = {};
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });

await page.goto(url, { waitUntil: "load", timeout: 25000 });
await page.bringToFront();
await page.waitForTimeout(1200);

const G = "__jousting3d";

const runMatch = (mode, fighter) => page.evaluate(async ([g, m, fight]) => {
  const game = window[g];
  document.querySelector(`.mode-card[data-mode="${m}"]`).click();
  document.querySelector("#startMatchButton").click();
  await new Promise((r) => setTimeout(r, 250));
  const t0 = performance.now();
  while (game.phase !== "ended" && performance.now() - t0 < 180000) {
    if (game.phase === "gate") game.strike(); // 衝鋒
    else if (fight && game.phase === "charging" && !game.armed) {
      const gap = game.aiZ - game.myZ;
      const closing = Math.max(game.speed + game.aiSpeed, 1);
      if (gap <= 26 && Math.abs(gap - 2.4) / closing <= 0.05) game.strike();
    }
    await new Promise((r) => setTimeout(r, 16));
  }
  return { phase: game.phase, my: game.myScore, ai: game.aiScore, passes: game.passNo, overlay: { ...game.overlay } };
}, [G, mode, fighter]);

await page.waitForTimeout(600);
await page.screenshot({ path: outDir + "/jo-menu.png" });

// —— 對決:完美騎士 ——
results.duelFight = await runMatch("duel", true);
await page.screenshot({ path: outDir + "/jo-finish.png" });

// —— 對決:全程不出槍 ——
await page.evaluate(() => document.querySelector("#overlayMenuButton").click());
await page.waitForTimeout(400);
results.duelPassive = await runMatch("duel", false);

// —— 搶七 ——
await page.evaluate(() => document.querySelector("#overlayMenuButton").click());
await page.waitForTimeout(400);
results.race7 = await runMatch("race7", true);

// —— 衝鋒中截圖(兩騎對衝+分隔柵+時機條) ——
await page.evaluate(() => document.querySelector("#overlayMenuButton").click());
await page.waitForTimeout(400);
await page.evaluate((g) => {
  document.querySelector('.mode-card[data-mode="duel"]').click();
  document.querySelector("#startMatchButton").click();
  setTimeout(() => window[g].strike(), 250);
}, G);
await page.waitForTimeout(2600);
await page.screenshot({ path: outDir + "/jo-charging.png" });
await page.waitForTimeout(1100); // 接近交錯
await page.screenshot({ path: outDir + "/jo-close.png" });

console.log(JSON.stringify({ results, errors }, null, 2));
await browser.close();
