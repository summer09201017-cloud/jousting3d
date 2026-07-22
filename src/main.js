import "./styles.css";
import { JoustingGame, GAME_MODES } from "./game.js";
import { AudioManager } from "./audio.js";
import { speakLine, setVoiceEnabled } from "./voice.js";
import { hasSavedGame, loadSettings, saveSettings } from "./storage.js";

const ui = {
  canvas: document.querySelector("#gameCanvas"),
  cameraButton: document.querySelector("#cameraButton"),
  myScoreLabel: document.querySelector("#myScoreLabel"),
  aiScoreLabel: document.querySelector("#aiScoreLabel"),
  modeCode: document.querySelector("#modeCode"),
  passLabel: document.querySelector("#passLabel"),
  gapLabel: document.querySelector("#gapLabel"),
  gapSideLabel: document.querySelector("#gapSideLabel"),
  lastPassLabel: document.querySelector("#lastPassLabel"),
  phaseLabel: document.querySelector("#phaseLabel"),
  statusMessage: document.querySelector("#statusMessage"),
  modeLabel: document.querySelector("#modeLabel"),
  difficultyLabel: document.querySelector("#difficultyLabel"),
  speedLabel: document.querySelector("#speedLabel"),
  audioStatus: document.querySelector("#audioStatus"),
  saveStatus: document.querySelector("#saveStatus"),
  installButton: document.querySelector("#installButton"),
  installHint: document.querySelector("#installHint"),
  loadButton: document.querySelector("#loadButton"),
  menuButton: document.querySelector("#menuButton"),
  audioButton: document.querySelector("#audioButton"),
  pauseButton: document.querySelector("#pauseButton"),
  touchControls: document.querySelector("#touchControls"),
  speedMeterFill: document.querySelector("#speedMeterFill"),
  speedMeterText: document.querySelector("#speedMeterText"),
  windowFill: document.querySelector("#windowFill"),
  windowValue: document.querySelector("#windowValue"),
  matchOverlay: document.querySelector("#matchOverlay"),
  overlayEyebrow: document.querySelector("#overlayEyebrow"),
  overlayTitle: document.querySelector("#overlayTitle"),
  overlayText: document.querySelector("#overlayText"),
  resumeButton: document.querySelector("#resumeButton"),
  overlayMenuButton: document.querySelector("#overlayMenuButton"),
  homeScreen: document.querySelector("#homeScreen"),
  modeCardGrid: document.querySelector("#modeCardGrid"),
  modeDescription: document.querySelector("#modeDescription"),
  menuDifficultySelect: document.querySelector("#menuDifficultySelect"),
  horseCoatSelect: document.querySelector("#horseCoatSelect"),
  weaponSelect: document.querySelector("#weaponSelect"),
  characterSelect: document.querySelector("#characterSelect"),
  weaponSideLabel: document.querySelector("#weaponSideLabel"),
  bigPowerLabel: document.querySelector("#bigPowerLabel"),
  weaponBar: document.querySelector("#weaponBar"),
  audioSelect: document.querySelector("#audioSelect"),
  modeMetaTitle: document.querySelector("#modeMetaTitle"),
  modeMetaGoal: document.querySelector("#modeMetaGoal"),
  startMatchButton: document.querySelector("#startMatchButton"),
  commentaryBar: document.querySelector("#commentaryBar"),
  continueSavedButton: document.querySelector("#continueSavedButton"),
};

const settings = loadSettings();
const audio = new AudioManager();
audio.setEnabled(settings.audioEnabled !== false);

const game = new JoustingGame({
  canvas: ui.canvas,
  touchRoot: ui.touchControls,
});
window.__jousting3d = game; // dev hook
window.__game = game; // /smoke3d 通用鉤子

let selectedModeId = game.modeId;
let selectedDifficulty = game.difficulty;
let selectedCoat = game.coatId;
let selectedWeapon = game.weaponId;
let selectedCharacter = game.characterId;
let audioEnabled = settings.audioEnabled !== false;

function persistSettings() {
  saveSettings({
    difficulty: selectedDifficulty,
    modeId: selectedModeId,
    horseCoat: selectedCoat,
    weaponId: selectedWeapon,
    character: selectedCharacter,
    audioEnabled,
  });
}

function setMeterFill(element, value) {
  element.style.transform = `scaleX(${Math.max(0, Math.min(1, value))})`;
}

function setAudioState(enabled) {
  audioEnabled = enabled;
  audio.setEnabled(enabled);
  setVoiceEnabled(enabled);
  ui.audioStatus.textContent = enabled ? "開啟" : "靜音";
  ui.audioButton.textContent = enabled ? "音效開啟" : "音效靜音";
  ui.audioSelect.value = enabled ? "on" : "off";
  persistSettings();
}

function syncMenuCards() {
  for (const button of ui.modeCardGrid.querySelectorAll(".mode-card")) {
    button.classList.toggle("selected", button.dataset.mode === selectedModeId);
  }
  const mode = GAME_MODES[selectedModeId];
  ui.modeDescription.textContent = mode.description;
  ui.modeMetaTitle.textContent = mode.label;
  ui.modeMetaGoal.textContent = mode.goal;
}

function syncMenuControls() {
  ui.menuDifficultySelect.value = selectedDifficulty;
  ui.horseCoatSelect.value = selectedCoat;
  ui.weaponSelect.value = selectedWeapon;
  ui.characterSelect.value = selectedCharacter;
  syncMenuCards();
}

function syncGameConfigurationToMenu() {
  selectedModeId = game.modeId;
  selectedDifficulty = game.difficulty;
  selectedCoat = game.coatId;
  selectedWeapon = game.weaponId;
  selectedCharacter = game.characterId;
  syncMenuControls();
}

function syncOverlay(overlay) {
  ui.matchOverlay.classList.toggle("visible", overlay.visible);
  ui.overlayEyebrow.textContent = overlay.eyebrow;
  ui.overlayTitle.textContent = overlay.title;
  ui.overlayText.textContent = overlay.text;
  ui.resumeButton.hidden = !overlay.canResume;
}

function openHomeScreen() {
  game.openHomeMenu();
  audio.stopCrowd();
  syncGameConfigurationToMenu();
  ui.homeScreen.classList.add("visible");
}

function closeHomeScreen() {
  ui.homeScreen.classList.remove("visible");
}

function unlockAudio() {
  audio.unlock();
}

function pushCommentary(text, tone = "info", spoken = text) {
  const bar = ui.commentaryBar;
  if (!bar || !text) return;
  bar.hidden = false;
  bar.dataset.tone = tone;
  bar.textContent = text;
  bar.style.animation = "none";
  void bar.offsetWidth;
  bar.style.animation = "";
  speakLine(spoken);
}

function handleGameEvent(event) {
  switch (event.type) {
    case "match-start": {
      audio.whistle();
      audio.startCrowd();
      audio.vibrate(18);
      pushCommentary("歡迎來到騎士大混戰!八般武器,點到為止!");
      break;
    }
    case "battle-start": {
      audio.horn();
      audio.vibrate(16);
      pushCommentary("開戰!", "hot", "號角響起,開戰!自由走位,看準時機出手!");
      break;
    }
    case "shoot": {
      audio.swish();
      if (event.who === "me") audio.vibrate(12);
      break;
    }
    case "miss": {
      if (event.who === "me") {
        audio.rebound();
        pushCommentary("這一下落空了——靠近、對準再出手!", "cool", "可惜,這一下落空了。");
      }
      break;
    }
    case "super": {
      audio.scoreSting();
      audio.swish();
      audio.vibrate([40, 20, 60]);
      if (event.who === "me") {
        pushCommentary(`蓄力大招——${event.weapon}波動出鞘!`, "hot", "蓄力大招,刀光出鞘!");
      } else {
        pushCommentary(`對手放出${event.weapon}大招波動——快閃開!`, "cool", "對手放出大招波動,快閃開!");
      }
      break;
    }
    case "leap": {
      audio.swish();
      audio.vibrate([26, 14, 30]);
      pushCommentary("跳殺——飛身躍向對手!", "hot", "跳殺,從天而降!");
      break;
    }
    case "dash": {
      audio.swish();
      audio.vibrate([20, 10, 40]);
      pushCommentary("飛殺——閃電突進!", "hot", "飛殺,快如閃電!");
      break;
    }
    case "block": {
      audio.rebound();
      audio.thud(0.4);
      audio.vibrate(18);
      if (event.who === "me") {
        pushCommentary("舉盾格擋——擋下來了!", "info", "舉盾格擋,擋下來了!");
      } else {
        pushCommentary("被對手舉盾擋下——繞到側面打!", "cool", "對手舉盾,繞到側面打!");
      }
      break;
    }
    case "parry": {
      audio.scoreSting();
      audio.rebound();
      audio.vibrate([30, 20, 50]);
      if (event.who === "me") {
        pushCommentary("完美盾反!對手被彈開!", "hot", "完美盾反,對手被彈開!");
      } else {
        pushCommentary("被對手盾反彈開——小心他的節奏!", "cool");
      }
      break;
    }
    case "ai-charging": {
      audio.rebound();
      pushCommentary("對手在蓄力大招——快閃開或打斷他!", "cool", "對手在蓄力,快閃開!");
      break;
    }
    case "weapon-switch": {
      audio.uiTap();
      if (event.who === "me") {
        pushCommentary(`換上${event.label}!`, "info", "換上新武器,打法一變!");
      } else {
        pushCommentary(`對手換上${event.label}——注意距離!`, "cool", "對手換武器了,注意距離!");
      }
      break;
    }
    case "hit": {
      if (event.who === "me") {
        audio.scoreSting();
        audio.crowdCheer(event.dmg >= 14 ? 0.9 : 0.5);
        audio.vibrate([30, 20, 45]);
        pushCommentary(
          `${event.weapon}命中!對手 -${event.dmg}${event.stun ? "(暈眩!)" : ""}(第 ${event.round} 回合)`,
          "hot",
          event.stun ? "鋼球命中,對手暈頭轉向!" : event.dmg >= 14 ? "正中要害,重重的一擊!" : "漂亮的一擊!",
        );
      } else {
        audio.thud(0.8);
        audio.vibrate(24);
        pushCommentary(
          `被${event.weapon}擊中 -${event.dmg}——拉開距離再反擊!`,
          "cool",
          "對手命中,小心走位!",
        );
      }
      break;
    }
    case "ko": {
      audio.horn();
      audio.crowdCheer(event.winner === "me" ? 1 : 0.6);
      audio.vibrate([110, 50, 120]);
      break;
    }
    case "match-end": {
      try { if (!['localhost','127.0.0.1'].includes(location.hostname)) {   // -done:玩完一局(t=本局秒數,/stats 使用次數與平均停留吃這個)
        var __dt = Math.round((Date.now() - (window.__matchT0 || Date.now())) / 1000);
        navigator.sendBeacon?.('https://hfpc-play-stats.summer09201017.workers.dev/api/ping?g=jousting3d-done&t=' + __dt);
      } } catch (_) {}
      pushCommentary(
        `終場!大戰 ${event.rounds} 回合,血量 ${event.myHp}:${event.aiHp}`,
        event.win ? "hot" : "info",
        event.win ? "紅騎士獲勝!全場歡呼!" : event.draw ? "平分秋色,再戰一場!" : "這場對手技高一籌,再來!",
      );
      ui.saveStatus.textContent = hasSavedGame() ? "已記錄" : "尚無";
      break;
    }
    default:
      break;
  }
}

game.onEvent = handleGameEvent;

game.onHudUpdate = (state) => {
  ui.myScoreLabel.textContent = String(state.myHp);
  ui.aiScoreLabel.textContent = String(state.aiHp);
  ui.modeCode.textContent = ({ 對決: "對決", 大戰三百回合: "三百回合", 練習場: "練習" })[state.modeLabel] || state.modeLabel;
  ui.passLabel.textContent = state.roundCap ? `${state.roundNo}/${state.roundCap}` : String(state.roundNo);
  ui.gapLabel.textContent = state.gapText;
  ui.gapSideLabel.textContent = state.gapText;
  ui.lastPassLabel.textContent = state.lastHit
    ? (state.lastHit.who === "me" ? `${state.lastHit.weapon} -${state.lastHit.dmg}` : `挨${state.lastHit.weapon} -${state.lastHit.dmg}`)
    : "—";
  ui.phaseLabel.textContent = state.phaseLabel;
  ui.statusMessage.textContent = state.message;
  ui.modeLabel.textContent = state.modeLabel;
  ui.difficultyLabel.textContent = state.difficultyLabel;
  ui.weaponSideLabel.textContent = state.weaponLabel;
  ui.speedLabel.textContent = state.speedText;
  ui.speedMeterText.textContent = state.speedText;
  setMeterFill(ui.speedMeterFill, state.speed01);
  ui.windowValue.textContent = state.charging
    ? (state.chargeReady ? "放開出大招!" : "蓄力中…")
    : state.weaponReady ? (state.inReach ? "可出手!" : "冷卻好了,靠近!") : "冷卻中…";
  setMeterFill(ui.windowFill, state.charging ? state.charge01 : state.weaponReady01);
  { // 1-8 武器條:出戰準備+激戰中顯示,高亮當前武器
    const inFight = state.phaseLabel === "激戰中" || state.phaseLabel === "出戰準備";
    ui.weaponBar.hidden = !inFight;
    if (inFight) {
      for (const chip of ui.weaponBar.querySelectorAll(".weapon-chip")) {
        chip.classList.toggle("active", chip.dataset.weapon === state.weaponId);
      }
    }
  }
  { // 中下方大出手條:戰鬥中顯示;滿+夠近=發光
    const bp = document.getElementById("bigPower"), bf = document.getElementById("bigPowerFill");
    if (bp) {
      bp.hidden = state.phaseLabel !== "激戰中";
      if (ui.bigPowerLabel) ui.bigPowerLabel.textContent = state.charging ? "蓄力大招" : `${state.weaponShort}出手`;
      bf.style.transform = `scaleX(${Math.min(1, state.charging ? state.charge01 : state.weaponReady01)})`;
      bf.classList.toggle("full", state.charging ? state.chargeReady : (state.weaponReady && state.inReach));
    }
  }
  syncOverlay(state.overlay);
};

syncGameConfigurationToMenu();
setAudioState(audioEnabled);
ui.saveStatus.textContent = hasSavedGame() ? "已記錄" : "尚無";

ui.modeCardGrid.addEventListener("click", (event) => {
  const button = event.target.closest(".mode-card");
  if (!button) return;
  unlockAudio();
  audio.uiTap();
  selectedModeId = button.dataset.mode;
  syncMenuCards();
  persistSettings();
});

ui.menuDifficultySelect.addEventListener("change", (event) => {
  selectedDifficulty = event.target.value;
  persistSettings();
});

ui.horseCoatSelect.addEventListener("change", (event) => {
  unlockAudio();
  audio.uiTap();
  selectedCoat = event.target.value;
  game.setHorseCoat(selectedCoat);
  persistSettings();
});

ui.weaponSelect.addEventListener("change", (event) => {
  unlockAudio();
  audio.uiTap();
  selectedWeapon = event.target.value;
  game.setPlayerWeapon(selectedWeapon, false);
  persistSettings();
});

ui.characterSelect.addEventListener("change", (event) => {
  unlockAudio();
  audio.uiTap();
  selectedCharacter = event.target.value;
  game.setCharacter(selectedCharacter);
  persistSettings();
});

ui.weaponBar.addEventListener("click", (event) => {
  const chip = event.target.closest(".weapon-chip");
  if (!chip) return;
  unlockAudio();
  game.setPlayerWeapon(chip.dataset.weapon);
});

ui.audioSelect.addEventListener("change", (event) => {
  unlockAudio();
  audio.uiTap();
  setAudioState(event.target.value === "on");
});

ui.startMatchButton.addEventListener("click", () => {
  window.__matchT0 = Date.now();   // -done beacon 用:本局開始時間
  unlockAudio();
  audio.uiTap();
  game.applyPresentation({
    difficulty: selectedDifficulty,
    modeId: selectedModeId,
    horseCoat: selectedCoat,
    weaponId: selectedWeapon,
    character: selectedCharacter,
  });
  game.startSelectedMatch();
  closeHomeScreen();
});

function loadIntoUi() {
  const loaded = game.loadGame();
  syncGameConfigurationToMenu();
  ui.saveStatus.textContent = loaded && hasSavedGame() ? "已記錄" : "尚無";
}

ui.continueSavedButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  loadIntoUi();
});

ui.loadButton.addEventListener("click", loadIntoUi);

ui.menuButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  openHomeScreen();
});

ui.overlayMenuButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  openHomeScreen();
});

ui.cameraButton.addEventListener("click", () => {
  game.cycleCameraView();
});

ui.audioButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  setAudioState(!audioEnabled);
});

ui.pauseButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  game.togglePause();
});

ui.resumeButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  game.resume();
});

window.addEventListener("pointerdown", unlockAudio, { passive: true });
window.addEventListener("keydown", unlockAudio, { passive: true });

let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  ui.installButton.hidden = false;
  ui.installHint.textContent = "已偵測到可安裝版本，點一下就能加入主畫面。";
});

ui.installButton.addEventListener("click", async () => {
  unlockAudio();
  audio.uiTap();
  if (!deferredInstallPrompt) {
    ui.installHint.textContent = "如果是 iPhone，請用分享選單的「加入主畫面」。";
    return;
  }
  deferredInstallPrompt.prompt();
  const outcome = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  ui.installButton.hidden = true;
  ui.installHint.textContent =
    outcome.outcome === "accepted" ? "安裝要求已送出。" : "你可以之後再安裝。";
});

window.addEventListener("appinstalled", () => {
  ui.installButton.hidden = true;
  ui.installHint.textContent = "已安裝到裝置。";
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    game.saveGame(true);
  }
});

// dev(localhost)不註冊 SW(07-11 踩雷)
if ("serviceWorker" in navigator && !["localhost", "127.0.0.1"].includes(location.hostname)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      ui.installHint.textContent = "Service Worker 註冊失敗，但仍可直接遊玩。";
    });
  });
}

game.start();
