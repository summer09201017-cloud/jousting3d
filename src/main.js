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
let audioEnabled = settings.audioEnabled !== false;

function persistSettings() {
  saveSettings({
    difficulty: selectedDifficulty,
    modeId: selectedModeId,
    horseCoat: selectedCoat,
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
  syncMenuCards();
}

function syncGameConfigurationToMenu() {
  selectedModeId = game.modeId;
  selectedDifficulty = game.difficulty;
  selectedCoat = game.coatId;
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
      pushCommentary("歡迎來到騎士錦標賽!點到為止,騎士精神!");
      break;
    }
    case "charge": {
      audio.horn();
      audio.vibrate(16);
      pushCommentary(`第 ${event.pass} 回合——衝鋒!`, "info", "號角響起,衝鋒!盯住時機條!");
      break;
    }
    case "strike": {
      audio.swish();
      audio.vibrate(14);
      break;
    }
    case "strike-early": {
      audio.rebound();
      pushCommentary("太早出槍了——等時機條進綠區!", "cool", "太早出槍了,穩住再出!");
      break;
    }
    case "pass-result": {
      if (event.myPts > 0) {
        audio.scoreSting();
        audio.crowdCheer(event.myPts === 2 ? 0.9 : 0.5);
        audio.vibrate([30, 20, 45]);
      } else {
        audio.thud(0.5);
      }
      if (event.aiPts > 0) audio.thud(0.8);
      const mySay = event.myPts === 2 ? "正中盾心!漂亮的一槍!" : event.myPts === 1 ? "擦中盾牌,拿下一分!" : "可惜,這槍落空了。";
      pushCommentary(
        `${event.mineText}｜${event.theirsText}(${event.myScore}:${event.aiScore})`,
        event.myPts === 2 ? "hot" : event.myPts === 0 ? "cool" : "info",
        mySay,
      );
      break;
    }
    case "match-end": {
      audio.horn();
      audio.crowdCheer(event.win ? 1 : 0.5);
      audio.vibrate([110, 50, 120]);
      pushCommentary(
        `終場 ${event.myScore}:${event.aiScore}!`,
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
  ui.myScoreLabel.textContent = String(state.myScore);
  ui.aiScoreLabel.textContent = String(state.aiScore);
  ui.modeCode.textContent = ({ 對決: "對決", 搶七: "搶七", 練習場: "練習" })[state.modeLabel] || state.modeLabel;
  ui.passLabel.textContent = `${state.passNo}/${state.totalPasses}`;
  ui.gapLabel.textContent = state.gapText;
  ui.gapSideLabel.textContent = state.gapText;
  ui.lastPassLabel.textContent = state.lastResult
    ? (state.lastResult.myPts === 2 ? "正中!" : state.lastResult.myPts === 1 ? "擦中" : "落空")
    : "—";
  ui.phaseLabel.textContent = state.phaseLabel;
  ui.statusMessage.textContent = state.message;
  ui.modeLabel.textContent = state.modeLabel;
  ui.difficultyLabel.textContent = state.difficultyLabel;
  ui.speedLabel.textContent = state.speedText;
  ui.speedMeterText.textContent = state.speedText;
  setMeterFill(ui.speedMeterFill, state.speed01);
  ui.windowValue.textContent = state.armed ? "已出槍" : state.approach01 > 0 ? (state.inWindow ? "綠區!出槍!" : "接近中…") : "—";
  setMeterFill(ui.windowFill, state.approach01);
  { // 中下方大時機條:對手接近時顯示,綠區=full 發光
    const bp = document.getElementById("bigPower"), bf = document.getElementById("bigPowerFill");
    if (bp) {
      bp.hidden = !(state.approach01 > 0 && !state.armed);
      bf.style.transform = `scaleX(${Math.min(1, state.approach01)})`;
      bf.classList.toggle("full", state.inWindow);
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

ui.audioSelect.addEventListener("change", (event) => {
  unlockAudio();
  audio.uiTap();
  setAudioState(event.target.value === "on");
});

ui.startMatchButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  game.applyPresentation({
    difficulty: selectedDifficulty,
    modeId: selectedModeId,
    horseCoat: selectedCoat,
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
