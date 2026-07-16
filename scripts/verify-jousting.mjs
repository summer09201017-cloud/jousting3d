// jousting3d 端到端驗證(07-16 自由馬戰版):
// ①kids 對決:自走 bot(追擊+出手)→ 應 KO 對手獲勝
// ②normal 被動局:玩家站著不動 → AI 應能追上並 KO 玩家(證明 AI 會走位會打)
// ③八般武器掃一輪:每把都出手,遠程要有投射物,全程 0 pageerror
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

const startMatch = (mode, difficulty, weapon) => page.evaluate(([g, m, d, w]) => {
  const game = window[g];
  game.applyPresentation({ difficulty: d, modeId: m, weaponId: w });
  game.startSelectedMatch();
  document.querySelector("#homeScreen").classList.remove("visible");
  game.strike(); // gate → battle
}, [G, mode, difficulty, weapon]);

const backToMenu = async () => {
  await page.evaluate(() => document.querySelector("#overlayMenuButton").click());
  await page.evaluate(() => document.querySelector("#homeScreen").classList.remove("visible"));
  await page.waitForTimeout(300);
};

// —— ① kids 對決:自走 bot 追擊出手 ——
await page.screenshot({ path: outDir + "/jo-menu.png" });
await startMatch("duel", "kids", "sword");
results.botDuel = await page.evaluate(async ([g]) => {
  const game = window[g];
  const t0 = performance.now();
  let midShot = false;
  while (game.phase !== "ended" && performance.now() - t0 < 120000) {
    const dx = game.foe.pos.x - game.my.pos.x;
    const dz = game.foe.pos.z - game.my.pos.z;
    const dist = Math.hypot(dx, dz);
    game.my.heading = Math.atan2(dx, dz); // bot 直接對準(測試走位交給 AI 局)
    game.input.held.add("up");
    if (dist < 3.0) {
      game.input.held.delete("up");
      game.strike();
    }
    await new Promise((r) => setTimeout(r, 32));
  }
  game.input.held.delete("up");
  return { phase: game.phase, myHp: game.my.hp, aiHp: game.foe.hp, rounds: game.roundNo, overlay: { ...game.overlay } };
}, [G]);
await page.screenshot({ path: outDir + "/jo-finish.png" });

// —— ② normal 被動局:玩家不動,AI 要能自己打贏 ——
await backToMenu();
await startMatch("duel", "normal", "lance");
results.aiActive = await page.evaluate(async ([g]) => {
  const game = window[g];
  const t0 = performance.now();
  while (game.phase !== "ended" && performance.now() - t0 < 240000) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return { phase: game.phase, myHp: game.my.hp, aiHp: game.foe.hp, rounds: game.roundNo };
}, [G]);

// —— ③ 八般武器掃一輪(練習場:AI 不還手,專心驗武器) ——
await backToMenu();
await startMatch("practice", "normal", "lance");
results.weapons = await page.evaluate(async ([g]) => {
  const game = window[g];
  const order = ["lance", "spear", "greatblade", "sword", "saber", "rapier", "bow", "greenballs"];
  const out = {};
  let sawProjectile = false;
  for (const id of order) {
    game.setPlayerWeapon(id);
    // 等冷卻歸零(換武器硬直+上一把殘留冷卻)
    const w0 = performance.now();
    while (game.my.cd > 0 && performance.now() - w0 < 4000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    // 對準對手出手(近戰可能太遠=落空,重點是不噴錯;遠程要生成投射物)
    const dx = game.foe.pos.x - game.my.pos.x;
    const dz = game.foe.pos.z - game.my.pos.z;
    game.my.heading = Math.atan2(dx, dz);
    const before = game.roundNo;
    game.strike();
    // 投射物命中即消失,出手後立刻高頻抽查
    for (let i = 0; i < 12; i += 1) {
      await new Promise((r) => setTimeout(r, 40));
      if (game.projectiles.length > 0) sawProjectile = true;
    }
    out[id] = { attacked: game.roundNo > before, weaponVisible: game.my.gear.weapons[id].visible };
  }
  return { perWeapon: out, sawProjectile, roundNo: game.roundNo };
}, [G]);
await page.screenshot({ path: outDir + "/jo-weapons.png" });

// —— 戰鬥中景截圖(自由走位+開放場地無分隔柵) ——
await backToMenu();
await startMatch("duel", "normal", "greatblade");
await page.evaluate(async ([g]) => {
  const game = window[g];
  const t0 = performance.now();
  while (performance.now() - t0 < 3500) {
    const dx = game.foe.pos.x - game.my.pos.x;
    const dz = game.foe.pos.z - game.my.pos.z;
    game.my.heading = Math.atan2(dx, dz);
    game.input.held.add("up");
    if (Math.hypot(dx, dz) < 3.2) game.strike();
    await new Promise((r) => setTimeout(r, 32));
  }
  game.input.held.delete("up");
}, [G]);
await page.screenshot({ path: outDir + "/jo-battle.png" });

console.log(JSON.stringify({ results, errors }, null, 2));
await browser.close();
