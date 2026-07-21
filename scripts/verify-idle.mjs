// verify-idle.mjs — 獨立 Playwright 驗證「idle 生動」(jousting3d 專屬 port=5424)
// 自起 vite preview、採樣證實會動、0 pageerror/0 console error、截三張圖。驗完 kill。
// 用 C:/Users/HFP/node_modules 的 playwright(不碰共用 MCP 瀏覽器)。
import pw from "file:///C:/Users/HFP/node_modules/playwright/index.js";
const { chromium } = pw;
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SHOTS = resolve(__dirname, "shots");
const PORT = 5424;
mkdirSync(SHOTS, { recursive: true });

const preview = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  cwd: ROOT, shell: true, stdio: ["ignore", "pipe", "pipe"],
});
preview.stdout.on("data", (d) => process.stdout.write(`[preview] ${d}`));
preview.stderr.on("data", (d) => process.stderr.write(`[preview] ${d}`));

const kill = () => { try { process.platform === "win32" ? spawn("taskkill", ["/pid", String(preview.pid), "/T", "/F"], { shell: true }) : preview.kill("SIGTERM"); } catch {} };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = `http://localhost:${PORT}/`;

async function waitServer() {
  for (let i = 0; i < 40; i += 1) {
    try { const r = await fetch(BASE); if (r.ok) return; } catch {}
    await sleep(500);
  }
  throw new Error("preview server did not come up");
}

let failed = false;
(async () => {
  await waitServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => { errors.push(`pageerror: ${e.message}`); });
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`); });

  await page.goto(BASE, { waitUntil: "load" });
  await page.bringToFront();
  await sleep(800);
  // 開戰到「出戰準備」(gate)——隱藏首頁 HTML 蓋層,騎士現身;gate≠battle,idle 仍跑
  await page.click("#startMatchButton").catch(() => {});
  await sleep(1200); // 準備場 idle 熱身

  // 讀 headGroup 起始 yaw(選單:兩騎待機,idle 應在轉頭)
  const sampleHead = async () => page.evaluate(() => {
    const g = window.__game;
    if (!g || !g.my || !g.my.person) return null;
    return {
      myYaw: g.my.person.headGroup ? g.my.person.headGroup.rotation.y : null,
      foeYaw: g.foe.person.headGroup ? g.foe.person.headGroup.rotation.y : null,
      crowd: g.crowdFigures ? g.crowdFigures.length : 0,
      crowdArm: g.crowdFigures && g.crowdFigures[0] ? g.crowdFigures[0].fig.leftArm.pivot.rotation.x : null,
    };
  });

  const s0 = await sampleHead();
  await sleep(2200);
  const s1 = await sampleHead();
  await sleep(2200);
  const s2 = await sampleHead();

  const moved = (a, b, c, key) => Math.abs((a?.[key] ?? 0) - (b?.[key] ?? 0)) > 1e-4 || Math.abs((b?.[key] ?? 0) - (c?.[key] ?? 0)) > 1e-4;
  const headMoved = s0 && (moved(s0, s1, s2, "myYaw") || moved(s0, s1, s2, "foeYaw"));
  const crowdMoved = s0 && moved(s0, s1, s2, "crowdArm");

  console.log("samples:", JSON.stringify({ s0, s1, s2 }));
  console.log("headMoved:", headMoved, "crowdMoved:", crowdMoved, "crowdCount:", s0?.crowd);
  if (s0?.crowd !== 16) { console.error("EXPECTED 16 crowd figures, got", s0?.crowd); failed = true; }
  if (!headMoved) { console.error("HEAD did not animate (idle)"); failed = true; }
  if (!crowdMoved) { console.error("CROWD arms did not animate"); failed = true; }

  // 凍結主迴圈(停 RAF),手動擺鏡頭拍靜態幀——否則 updateCamera 會把相機拉回跟隨位
  const frameShot = async (path, camSetup) => {
    await page.evaluate((setup) => {
      const g = window.__game;
      g.running = false; // 停 RAF,鏡頭不被 updateCamera 拉走
      const p = g.my.pos, f = g.foe.pos;
      if (setup === "face") {
        // 露臉觀眾特寫(驗耳前無髮):左看台中段人偶,臉朝 +x,鏡頭擺其正前方
        const fig = g.crowdFigures.find((c) => c.fig.group.position.z > 3 && c.fig.group.position.x < 0);
        const gp = fig.fig.group.position;
        g.camera.position.set(gp.x + 1.9, 2.05, gp.z + 0.15); g.camera.lookAt(gp.x, 1.95, gp.z);
      }
      else if (setup === "crowd") { g.camera.position.set(0, 8, -40); g.camera.lookAt(-33, 1.2, -6); }
      else { g.camera.position.set(6, 9, -30); g.camera.lookAt((p.x + f.x) / 2, 1.4, (p.z + f.z) / 2); }
      g.render();
    }, camSetup);
    await sleep(150);
    await page.screenshot({ path });
  };
  await frameShot(resolve(SHOTS, "01-face-closeup.png"), "face");
  await frameShot(resolve(SHOTS, "02-crowd-wave.png"), "crowd");
  await frameShot(resolve(SHOTS, "03-overview.png"), "overview");

  if (errors.length) { console.error("PAGE ERRORS:\n" + errors.join("\n")); failed = true; }
  else console.log("0 pageerror / 0 console.error");

  await browser.close();
  kill();
  console.log(failed ? "RESULT: FAIL" : "RESULT: PASS");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("VERIFY CRASH:", e); kill(); process.exit(1); });
