import * as THREE from "three";
import { InputManager } from "./input.js";
import { loadSettings, saveSettings, loadSavedGame, saveGameState } from "./storage.js";

// —— 3D 騎士比武(jousting3d,德義武鬥館)——騎乘引擎的「對衝時機」變體(2026-07-15 拍板)。
// 中世紀錦標賽運動化包裝:兩騎沿分隔柵對衝,綠區時機出槍「擊盾」得分——
// ★點到為止無 KO(拳擊館同款原則):被擊中=盾牌閃光+後仰苦臉,不落馬、不受傷、no blood。
// 玩法:①按住加速控衝鋒速度(全速=時機窗更窄,張力)②對手接近時綠區按「出槍」。
// ★判定=畫面(鐵則4):按下當下用時機誤差算正中盾心(2分)/擦中(1分)/落空(0分),交錯瞬間才演擊中。

// ---------- 可調量值 ----------
// window=出槍時機窗(秒);aiSkill=對手平均出槍品質;passes=回合數
export const DIFFICULTY_PRESETS = {
  kids: { baseSpeed: 6.0, boost: 2.2, window: 0.34, aiSkill: 0.3, passes: 5, assist: 0.5 },
  child: { baseSpeed: 7.0, boost: 2.8, window: 0.26, aiSkill: 0.42, passes: 5, assist: 0.3 },
  easy: { baseSpeed: 8.0, boost: 3.4, window: 0.2, aiSkill: 0.55, passes: 5, assist: 0.15 },
  normal: { baseSpeed: 9.0, boost: 4.0, window: 0.15, aiSkill: 0.68, passes: 5, assist: 0 },
  hard: { baseSpeed: 10.0, boost: 4.8, window: 0.11, aiSkill: 0.8, passes: 7, assist: 0 },
};

export const DIFFICULTY_LABELS = {
  kids: "幼兒(超簡單)",
  child: "兒童(簡單)",
  easy: "入門",
  normal: "標準",
  hard: "職業",
};

export const GAME_MODES = {
  duel: {
    label: "對決",
    description: "五回合對衝(職業七回合):正中盾心 2 分、擦中 1 分——總分高者勝!",
    goal: "總分高者勝",
  },
  race7: {
    label: "搶七",
    race: 7,
    description: "不限回合,先搶到 7 分的騎士獲勝——每一槍都是關鍵!",
    goal: "先到 7 分",
  },
  practice: {
    label: "練習場",
    endless: true,
    description: "無限回合自由練——熟悉對衝節奏與綠區出槍手感(對手不計分)。",
    goal: "純練手感,不計勝負",
  },
};

export function getModeConfig(modeId) {
  return GAME_MODES[modeId] || GAME_MODES.duel;
}

// ---------- 對衝道常數 ----------
const LANE_HALF = 42; // 起點離中線距離(m)
const LANE_X = 1.05; // 兩騎各自離分隔柵的側距
const STRIKE_IDEAL = 2.4; // 理想出槍點:與對手還差 2.4m(槍長)
const ARM_RANGE = 26; // 進入「備戰」提示的距離(相對距離)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- 人物(系列 makePerson:臉部鐵則+關節人物) ----------
function createLimb({ upperMaterial, lowerMaterial, endMaterial, upperLen, lowerLen, upperRadius, lowerRadius, end = "hand", thumbSide = 1 }) {
  const pivot = new THREE.Group();
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(upperRadius, upperLen, 4, 8), upperMaterial);
  upper.position.y = -upperLen / 2;
  pivot.add(upper);
  const joint = new THREE.Group();
  joint.position.y = -upperLen;
  pivot.add(joint);
  const lower = new THREE.Mesh(new THREE.CapsuleGeometry(lowerRadius, lowerLen, 4, 8), lowerMaterial);
  lower.position.y = -lowerLen / 2;
  joint.add(lower);
  let endMesh;
  if (end === "foot") {
    endMesh = new THREE.Mesh(new THREE.BoxGeometry(lowerRadius * 2.1, lowerRadius, lowerRadius * 3.4), endMaterial);
    endMesh.position.set(0, -lowerLen - lowerRadius * 0.4, lowerRadius * 0.9);
  } else {
    const r = lowerRadius;
    endMesh = new THREE.Group();
    endMesh.position.y = -lowerLen - r * 0.2;
    const palm = new THREE.Mesh(new THREE.BoxGeometry(r * 2.2, r * 1.7, r * 1.0), endMaterial);
    palm.position.y = -r * 0.85;
    endMesh.add(palm);
    for (let i = 0; i < 4; i += 1) {
      const finger = new THREE.Mesh(new THREE.BoxGeometry(r * 0.44, r * 1.25, r * 0.55), endMaterial);
      finger.position.set((i - 1.5) * r * 0.54, -r * 2.1, 0);
      finger.rotation.x = 0.14;
      endMesh.add(finger);
    }
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(r * 0.5, r * 1.0, r * 0.55), endMaterial);
    thumb.position.set(thumbSide * r * 1.3, -r * 0.95, r * 0.1);
    thumb.rotation.z = thumbSide * -0.55;
    endMesh.add(thumb);
  }
  joint.add(endMesh);
  return { pivot, upper, joint, lower, end: endMesh };
}

const HAIR_COLORS = [0x2b2119, 0x4a3120, 0x151515, 0x5e4630, 0x7a5636, 0x3a3a45];

function makePerson({ shirt = 0x2f6f4e, pants = 0x2a3550, skin = 0xf3cca6, hair = 0x2b2119, gender = "m", scale = 1 } = {}) {
  const group = new THREE.Group();
  const rig = new THREE.Group();
  group.add(rig);
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.72 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.78, emissive: 0x8a7355, emissiveIntensity: 0.5 });

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.76, 0.32), shirtMat);
  chest.position.y = 1.42;
  rig.add(chest);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.2, 12), skinMat);
  neck.position.y = 1.88;
  rig.add(neck);
  const waist = new THREE.Group();
  waist.position.y = 1.16;
  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.3, 0.27), shirtMat);
  belly.position.y = -0.05;
  waist.add(belly);
  const hip = new THREE.Mesh(
    gender === "f" ? new THREE.BoxGeometry(0.48, 0.22, 0.3) : new THREE.BoxGeometry(0.42, 0.2, 0.27),
    pantsMat,
  );
  hip.position.y = -0.26;
  waist.add(hip);
  const beltLine = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.06, 0.28), new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 0.6 }));
  beltLine.position.y = -0.15;
  waist.add(beltLine);
  rig.add(waist);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 18, 18), skinMat);
  head.position.y = 2.12;
  rig.add(head);
  const earL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), skinMat);
  earL.scale.set(0.45, 1, 0.8);
  earL.position.set(-0.245, 2.11, 0);
  rig.add(earL);
  const earR = earL.clone();
  earR.position.x = 0.245;
  rig.add(earR);

  const hairMat = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.85 });
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.265, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.46), hairMat);
  hairCap.position.y = 2.13;
  hairCap.rotation.x = -0.22;
  rig.add(hairCap);
  const hairBack = new THREE.Mesh(
    new THREE.SphereGeometry(0.255, 16, 8, Math.PI, Math.PI, Math.PI * 0.35, Math.PI * (gender === "f" ? 0.38 : 0.22)),
    hairMat,
  );
  hairBack.position.y = 2.12;
  rig.add(hairBack);

  const faceDark = new THREE.MeshBasicMaterial({ color: 0x25201a });
  const faceWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), faceWhite);
  eyeL.position.set(-0.09, 2.18, 0.21);
  rig.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.09;
  rig.add(eyeR);
  const pupilL = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), faceDark);
  pupilL.position.set(-0.09, 2.18, 0.25);
  rig.add(pupilL);
  const pupilR = pupilL.clone();
  pupilR.position.x = 0.09;
  rig.add(pupilR);
  const browL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.02), faceDark);
  browL.position.set(-0.09, 2.26, 0.22);
  browL.rotation.z = 0.16;
  rig.add(browL);
  const browR = browL.clone();
  browR.position.x = 0.09;
  browR.rotation.z = -0.16;
  rig.add(browR);
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 8, 14, Math.PI), faceDark);
  smile.position.set(0, 2.04, 0.21);
  smile.rotation.z = Math.PI;
  rig.add(smile);

  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.85 });
  const mkArm = (x) => {
    const arm = createLimb({
      upperMaterial: shirtMat, lowerMaterial: skinMat, endMaterial: skinMat,
      upperLen: 0.27, lowerLen: 0.26, upperRadius: 0.07, lowerRadius: 0.058,
      end: "hand", thumbSide: x < 0 ? 1 : -1,
    });
    arm.pivot.position.set(x, 1.72, 0);
    arm.joint.rotation.x = -0.18;
    rig.add(arm.pivot);
    return arm;
  };
  const leftArm = mkArm(-0.4);
  const rightArm = mkArm(0.4);
  const mkLeg = (x) => {
    const leg = createLimb({
      upperMaterial: pantsMat, lowerMaterial: pantsMat, endMaterial: shoeMat,
      upperLen: 0.40, lowerLen: 0.38, upperRadius: 0.09, lowerRadius: 0.072,
      end: "foot",
    });
    leg.pivot.position.set(x, 1.0, 0);
    leg.pivot.rotation.x = -0.05;
    leg.joint.rotation.x = 0.1;
    rig.add(leg.pivot);
    return leg;
  };
  const leftLeg = mkLeg(-0.15);
  const rightLeg = mkLeg(0.15);

  group.scale.setScalar(scale);
  return { group, rig, head, waist, leftArm, rightArm, leftLeg, rightLeg };
}

// ---------- 馬(長腿 v2+鬃毛三件套;coatMat/maneMat 可換色) ----------
export const HORSE_COATS = {
  brown: { label: "棗棕", coat: 0x8a5a33, mane: 0x3a2a1c },
  white: { label: "白馬", coat: 0xe8e4da, mane: 0xcfc8b8 },
  black: { label: "黑馬", coat: 0x2e2a28, mane: 0x14110f },
  chestnut: { label: "紅棕(栗色)", coat: 0xa04528, mane: 0x5a2415 },
  grey: { label: "銀灰", coat: 0x9aa0a8, mane: 0x5f6670 },
  palomino: { label: "金黃", coat: 0xd8a850, mane: 0xf0e6d0 },
  pinto: { label: "花斑(棕白)", coat: 0xb08050, mane: 0xefe9da },
};

function makeHorse({ coat = 0x8a5a33, mane = 0x3a2a1c, caparison = null } = {}) {
  const group = new THREE.Group();
  const coatMat = new THREE.MeshStandardMaterial({ color: coat, roughness: 0.7 });
  const maneMat = new THREE.MeshStandardMaterial({ color: mane, roughness: 0.85 });
  const sockMat = new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.8 });
  const hoofMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.6 });

  const rig = new THREE.Group();
  group.add(rig);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 1.7), coatMat);
  body.position.set(0, 1.58, 0);
  rig.add(body);
  const chestCap = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.5, 0.4), coatMat);
  chestCap.position.set(0, 1.62, 0.95);
  rig.add(chestCap);
  const rump = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.5, 0.42), coatMat);
  rump.position.set(0, 1.6, -0.95);
  rig.add(rump);

  // 錦標賽馬衣(caparison):隊色布幔罩軀幹,比武的儀式感
  if (caparison) {
    const capMat = new THREE.MeshStandardMaterial({ color: caparison, roughness: 0.9 });
    const drape = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.5, 1.85), capMat);
    drape.position.set(0, 1.24, 0);
    rig.add(drape);
    const skirtL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 1.7), capMat);
    skirtL.position.set(-0.38, 0.95, 0);
    rig.add(skirtL);
    const skirtR = skirtL.clone();
    skirtR.position.x = 0.38;
    rig.add(skirtR);
  }

  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 1.82, 1.05);
  rig.add(neckPivot);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.72, 0.34), coatMat);
  neck.rotation.x = 0.7;
  neck.position.set(0, 0.26, 0.2);
  neckPivot.add(neck);
  const head = new THREE.Group();
  head.position.set(0, 0.62, 0.5);
  neckPivot.add(head);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.52), coatMat);
  skull.rotation.x = 0.35;
  head.add(skull);
  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.3), maneMat);
  muzzle.position.set(0, -0.12, 0.34);
  muzzle.rotation.x = 0.35;
  head.add(muzzle);
  const faceWhiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const faceDarkMat = new THREE.MeshBasicMaterial({ color: 0x1c1712 });
  for (const side of [-1, 1]) {
    const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), faceWhiteMat);
    eyeWhite.position.set(side * 0.14, 0.06, 0.14);
    head.add(eyeWhite);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), faceDarkMat);
    pupil.position.set(side * 0.165, 0.06, 0.15);
    head.add(pupil);
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), coatMat);
    ear.position.set(side * 0.09, 0.24, -0.05);
    ear.rotation.x = -0.2;
    head.add(ear);
  }
  // 鬃毛三件套(07-15 鐵則)
  const maneCrest = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.88, 0.24), maneMat);
  maneCrest.rotation.x = 0.7;
  maneCrest.position.set(0, 0.36, -0.04);
  neckPivot.add(maneCrest);
  const maneSide = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.74, 0.34), maneMat);
  maneSide.rotation.x = 0.7;
  maneSide.position.set(0.17, 0.24, 0.08);
  neckPivot.add(maneSide);
  const forelock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.12), maneMat);
  forelock.position.set(0, 0.24, 0.08);
  head.add(forelock);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.66, 0.14), maneMat);
  tail.position.set(0, 1.45, -1.22);
  tail.rotation.x = 0.55;
  rig.add(tail);

  const mkLeg = (x, z, sock) => {
    const leg = createLimb({
      upperMaterial: coatMat,
      lowerMaterial: sock ? sockMat : coatMat,
      endMaterial: hoofMat,
      upperLen: 0.62, lowerLen: 0.6, upperRadius: 0.085, lowerRadius: 0.062, // 長腿 v3(07-15 再點名) // 長腿 v2
      end: "foot",
    });
    leg.pivot.position.set(x, 1.35, z);
    rig.add(leg.pivot);
    return leg;
  };
  const legs = [
    mkLeg(-0.22, 0.72, true),
    mkLeg(0.22, 0.72, true),
    mkLeg(-0.22, -0.78, false),
    mkLeg(0.22, -0.78, false),
  ];

  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.62), new THREE.MeshStandardMaterial({ color: 0x4a2f1c, roughness: 0.5 }));
  saddle.position.set(0, 1.95, 0.12);
  rig.add(saddle);

  return { group, rig, body, neckPivot, head, tail, legs, saddle, coatMat, maneMat };
}

// ---------- 騎士裝備:頭盔+羽飾、盾、比武槍(鈍頭 coronel) ----------
function knightUp(person, teamColor, plumeColor) {
  const teamMat = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.6 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0xb9c0c8, metalness: 0.65, roughness: 0.35 });
  // 全罩盔(蓋住頭髮)+隊色羽飾
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.29, 16, 12), steelMat);
  helm.position.y = 2.12;
  person.rig.add(helm);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.12), new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.4 }));
  visor.position.set(0, 2.12, 0.24);
  person.rig.add(visor);
  const plume = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.34, 0.16), new THREE.MeshStandardMaterial({ color: plumeColor, roughness: 0.9 }));
  plume.position.set(0, 2.48, -0.05);
  plume.rotation.x = -0.3;
  person.rig.add(plume);
  // 胸甲(隊色罩袍上的鋼片)
  const breast = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.5, 0.1), steelMat);
  breast.position.set(0, 1.5, 0.19);
  person.rig.add(breast);
  // 盾(左臂,隊色+白十字紋)
  const shield = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.07), teamMat);
  shield.add(board);
  const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.02), new THREE.MeshStandardMaterial({ color: 0xf5f0e0, roughness: 0.8 }));
  crossV.position.z = 0.045;
  shield.add(crossV);
  const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.02), new THREE.MeshStandardMaterial({ color: 0xf5f0e0, roughness: 0.8 }));
  crossH.position.z = 0.045;
  crossH.position.y = 0.08;
  shield.add(crossH);
  shield.position.set(0, -0.3, 0.12);
  person.leftArm.joint.add(shield);
  // 比武槍(右手:長錐,鈍頭護冠;隊色螺旋帶用兩節色環代替)
  const lance = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.06, 3.1, 10), new THREE.MeshStandardMaterial({ color: 0xd9c9a8, roughness: 0.7 }));
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = 1.25;
  lance.add(shaft);
  for (let i = 0; i < 3; i += 1) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.22, 10), teamMat);
    band.rotation.x = Math.PI / 2;
    band.position.z = 0.6 + i * 0.8;
    lance.add(band);
  }
  const guard = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.22, 12), steelMat);
  guard.rotation.x = -Math.PI / 2;
  guard.position.z = 0.28;
  lance.add(guard);
  const coronel = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), steelMat); // 鈍頭(點到為止)
  coronel.position.z = 2.82;
  lance.add(coronel);
  lance.position.set(0, -0.28, 0.1);
  person.rightArm.joint.add(lance);
  return { shield, lance };
}

export class JoustingGame {
  constructor({ canvas, touchRoot }) {
    this.canvas = canvas;
    this.touchRoot = touchRoot;

    const settings = loadSettings();
    this.difficulty = DIFFICULTY_PRESETS[settings.difficulty] ? settings.difficulty : "normal";
    this.modeId = GAME_MODES[settings.modeId] ? settings.modeId : "duel";
    this.mode = getModeConfig(this.modeId);
    this.coatId = HORSE_COATS[settings.horseCoat] ? settings.horseCoat : "brown";

    this.input = new InputManager();
    this.input.bindTouchButtons(this.touchRoot);

    this.onHudUpdate = null;
    this.onEvent = null;

    this.running = false; // ★只給主迴圈 RAF 用
    this.time = 0;
    this.phase = "menu"; // menu | gate | charging | passing | reset | ended
    this.message = "在首頁選擇模式與難度後開始。";
    this.cameraView = 0; // 0 跟隨 1 側面轉播 2 高空 3 馬上
    this.autoSaveTimer = 0;

    // 對衝狀態
    this.passNo = 1;
    this.myScore = 0;
    this.aiScore = 0;
    this.myZ = -LANE_HALF;
    this.aiZ = LANE_HALF;
    this.speed = 0;
    this.aiSpeed = 0;
    this.gallopT = 0;
    this.aiGallopT = 0;
    this.armed = false; // 本回合已出槍
    this.myQuality = null;
    this.lastResult = null; // {mine, theirs} 每回合結果文字
    this.resetT = 0;
    this.hitReactT = 9; // 被擊中後仰計時
    this.aiHitReactT = 9;
    this.strikeAnimT = 9; // 出槍前刺動畫

    this.overlay = { visible: false, eyebrow: "", title: "", text: "", canResume: false };

    // ---- three ----
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fc4e8);
    this.scene.fog = new THREE.Fog(0x9fd0ee, 70, 180);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 260);
    this.camPos = new THREE.Vector3(4, 5, -LANE_HALF - 10);
    this.camLook = new THREE.Vector3(0, 1.4, 0);
    this.camera.position.copy(this.camPos);

    this.clock = new THREE.Clock();

    this.setupScene();
    this.setupInput();

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.pushHud();
  }

  emitEvent(type, payload = {}) {
    if (this.onEvent) this.onEvent({ type, ...payload });
  }

  // ---------- 場景:比武場+分隔柵+看台 ----------
  setupScene() {
    const sun = new THREE.HemisphereLight(0xffffff, 0x557040, 1.3);
    this.scene.add(sun);
    const key = new THREE.DirectionalLight(0xfff2d4, 1.9);
    key.position.set(30, 50, -20);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9ccbff, 0.6);
    rim.position.set(-25, 30, 25);
    this.scene.add(rim);

    const grass = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), new THREE.MeshStandardMaterial({ color: 0x5c8a48, roughness: 1 }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.02;
    this.scene.add(grass);
    // 比武沙道
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(14, LANE_HALF * 2 + 24), new THREE.MeshStandardMaterial({ color: 0xd2bd93, roughness: 1 }));
    sand.rotation.x = -Math.PI / 2;
    this.scene.add(sand);

    // 分隔柵(tilt barrier):中線木柵一路到底
    const tiltMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.8 });
    const tilt = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.4, LANE_HALF * 2 + 10), tiltMat);
    tilt.position.set(0, 0.7, 0);
    this.scene.add(tilt);
    const tiltTop = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, LANE_HALF * 2 + 10), new THREE.MeshStandardMaterial({ color: 0xa8763c, roughness: 0.7 }));
    tiltTop.position.set(0, 1.44, 0);
    this.scene.add(tiltTop);

    // 兩端起跑旗門
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.8 });
    for (const endZ of [-LANE_HALF - 3, LANE_HALF + 3]) {
      for (const px of [-4, 4]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.4, 8), poleMat);
        pole.position.set(px, 1.7, endZ);
        this.scene.add(pole);
        const flag = new THREE.Mesh(
          new THREE.PlaneGeometry(0.9, 0.5),
          new THREE.MeshStandardMaterial({ color: px < 0 ? 0xb03030 : 0x2f5f9a, roughness: 0.85, side: THREE.DoubleSide }),
        );
        flag.position.set(px + 0.5, 3.1, endZ);
        this.scene.add(flag);
      }
    }
    // 沿道彩旗
    for (let i = 0; i < 9; i += 1) {
      const z = -LANE_HALF + i * (LANE_HALF * 2 / 8);
      for (const side of [-1, 1]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8), poleMat);
        pole.position.set(side * 6.5, 1.3, z);
        this.scene.add(pole);
        const pennant = new THREE.Mesh(
          new THREE.PlaneGeometry(0.55, 0.3),
          new THREE.MeshStandardMaterial({ color: i % 2 ? 0xf6d743 : (side < 0 ? 0xb03030 : 0x2f5f9a), roughness: 0.85, side: THREE.DoubleSide }),
        );
        pennant.position.set(side * 6.5 + 0.3, 2.45, z);
        this.scene.add(pennant);
      }
    }

    // 觀眾看台(兩側,有臉)
    this.crowd = new THREE.Group();
    const standMat = new THREE.MeshStandardMaterial({ color: 0x6b7687, roughness: 0.85 });
    for (const side of [-1, 1]) {
      const stand = new THREE.Mesh(new THREE.BoxGeometry(5, 3.2, 70), standMat);
      stand.position.set(side * 12.5, 1.6, 0);
      this.scene.add(stand);
      const shirts = [0xd98a3d, 0x3d78d9, 0xc94f8f, 0x4fae6a, 0xb0552f, 0x8a5ac0];
      for (let i = 0; i < 8; i += 1) {
        const p = makePerson({
          shirt: shirts[(i + (side > 0 ? 3 : 0)) % shirts.length],
          pants: 0x2c3340,
          hair: HAIR_COLORS[(i * 2 + (side > 0 ? 1 : 0)) % HAIR_COLORS.length],
          gender: (i + (side > 0 ? 1 : 0)) % 2 === 0 ? "m" : "f",
          scale: 0.92,
        });
        p.group.position.set(side * 9.2, 0, -31 + i * 9);
        p.group.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2; // 臉朝比武道
        this.crowd.add(p.group);
      }
    }
    this.scene.add(this.crowd);

    // 我方:紅騎士(玩家,右道 x=+LANE_X 朝 +z);對手:藍騎士(左道朝 -z)
    const coat = HORSE_COATS[this.coatId] || HORSE_COATS.brown;
    this.myHorse = makeHorse({ coat: coat.coat, mane: coat.mane, caparison: 0xb03030 });
    this.scene.add(this.myHorse.group);
    this.me = makePerson({ shirt: 0xb03030, pants: 0x5a2a2a, scale: 0.95 });
    this.me.leftLeg.pivot.rotation.x = -1.25;
    this.me.leftLeg.pivot.rotation.z = 0.5;
    this.me.leftLeg.joint.rotation.x = 1.5;
    this.me.rightLeg.pivot.rotation.x = -1.25;
    this.me.rightLeg.pivot.rotation.z = -0.5;
    this.me.rightLeg.joint.rotation.x = 1.5;
    this.myGear = knightUp(this.me, 0xb03030, 0xf6d743);
    this.me.group.position.set(0, 0.82, 0.12);
    this.me.group.scale.setScalar(0.95);
    this.myHorse.rig.add(this.me.group);

    this.aiHorse = makeHorse({ coat: 0x4a4a52, mane: 0x1c1c22, caparison: 0x2f5f9a });
    this.scene.add(this.aiHorse.group);
    this.ai = makePerson({ shirt: 0x2f5f9a, pants: 0x24304a, scale: 0.95 });
    this.ai.leftLeg.pivot.rotation.x = -1.25;
    this.ai.leftLeg.pivot.rotation.z = 0.5;
    this.ai.leftLeg.joint.rotation.x = 1.5;
    this.ai.rightLeg.pivot.rotation.x = -1.25;
    this.ai.rightLeg.pivot.rotation.z = -0.5;
    this.ai.rightLeg.joint.rotation.x = 1.5;
    this.aiGear = knightUp(this.ai, 0x2f5f9a, 0xf5f0e0);
    this.ai.group.position.set(0, 0.82, 0.12);
    this.ai.group.scale.setScalar(0.95);
    this.aiHorse.rig.add(this.ai.group);

    // 擊中閃光(盾上亮一圈)
    this.hitFlash = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.42, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0, side: THREE.DoubleSide }),
    );
    this.scene.add(this.hitFlash);
    this.hitFlashT = 9;

    this.placeRiders();
  }

  placeRiders() {
    // 玩家在 x=+LANE_X 朝 +z;AI 在 x=-LANE_X 朝 -z(左肩對左肩,盾側面向分隔柵)
    this.myHorse.group.position.set(LANE_X, 0, this.myZ);
    this.myHorse.group.rotation.y = 0;
    this.aiHorse.group.position.set(-LANE_X, 0, this.aiZ);
    this.aiHorse.group.rotation.y = Math.PI;
  }

  setHorseCoat(coatId) {
    if (!HORSE_COATS[coatId]) return;
    this.coatId = coatId;
    if (this.myHorse) {
      this.myHorse.coatMat.color.setHex(HORSE_COATS[coatId].coat);
      this.myHorse.maneMat.color.setHex(HORSE_COATS[coatId].mane);
    }
  }

  // ---------- 輸入 ----------
  setupInput() {
    this.canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.strike();
    });
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  // ---------- 局面控制 ----------
  applyPresentation({ difficulty, modeId, horseCoat }) {
    if (difficulty && DIFFICULTY_PRESETS[difficulty]) this.difficulty = difficulty;
    if (modeId && GAME_MODES[modeId]) {
      this.modeId = modeId;
      this.mode = getModeConfig(modeId);
    }
    if (horseCoat && HORSE_COATS[horseCoat]) this.setHorseCoat(horseCoat);
    saveSettings({ difficulty: this.difficulty, modeId: this.modeId, horseCoat: this.coatId });
    this.message = `${this.mode.label} · ${DIFFICULTY_LABELS[this.difficulty]} · ${HORSE_COATS[this.coatId].label} 已設定。`;
    this.pushHud();
  }

  openHomeMenu() {
    this.phase = "menu";
    this.overlay.visible = false;
    this.message = "在首頁選擇模式與難度後開始。";
    this.pushHud();
  }

  startSelectedMatch() {
    this.passNo = 1;
    this.myScore = 0;
    this.aiScore = 0;
    this.lastResult = null;
    this.beginPass(true);
    this.emitEvent("match-start", { mode: this.mode.label });
    this.pushHud();
  }

  beginPass(first = false) {
    this.myZ = -LANE_HALF;
    this.aiZ = LANE_HALF;
    this.speed = 0;
    this.aiSpeed = 0;
    this.armed = false;
    this.myQuality = null;
    this.aiStruck = false;
    this.strikeAnimT = 9;
    this.hitReactT = 9;
    this.aiHitReactT = 9;
    this.placeRiders();
    // 鏡頭硬切到玩家後方(lerp 穿場鐵則)
    this.camPos.set(LANE_X + 2.2, 4.2, this.myZ - 9);
    this.camLook.set(LANE_X, 1.6, this.myZ + 8);
    this.phase = "gate";
    this.message = first
      ? "點畫面吹號衝鋒!對手接近、時機條進綠區時再點一下「出槍」!"
      : `第 ${this.passNo} 回合——點畫面衝鋒!`;
    this.pushHud();
  }

  // 出發/出槍共用(點畫面/空白鍵)
  strike() {
    if (this.overlay.visible) return;
    if (this.phase === "gate") {
      this.phase = "charging";
      this.emitEvent("charge", { pass: this.passNo });
      this.message = "衝鋒!按住 W/↑ 全速——盯住時機條,綠區出槍!";
      this.pushHud();
      return;
    }
    if (this.phase !== "charging" || this.armed) return;
    const gap = this.aiZ - this.myZ; // 兩騎距離
    if (gap > ARM_RANGE) {
      this.message = "太早出槍了——等對手進到時機條亮起再出!";
      this.emitEvent("strike-early");
      this.pushHud();
      return;
    }
    this.armed = true;
    this.strikeAnimT = 0;
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const closing = Math.max(this.speed + this.aiSpeed, 1);
    const err = Math.abs(gap - STRIKE_IDEAL) / closing;
    let q = clamp(1 - err / (preset.window * 2.2), 0, 1);
    q = clamp(q + preset.assist * (1 - q), 0, 1);
    this.myQuality = q;
    this.emitEvent("strike", { quality: q });
    this.pushHud();
  }

  resolvePass() {
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    // 我方得分
    let myPts = 0;
    if (this.myQuality !== null) {
      myPts = this.myQuality >= 0.85 ? 2 : this.myQuality >= 0.45 ? 1 : 0;
    }
    // 對手出槍品質(依難度;練習場不計分)
    const aiQ = clamp(preset.aiSkill + (Math.random() * 2 - 1) * 0.28, 0, 1);
    let aiPts = this.mode.endless ? 0 : aiQ >= 0.85 ? 2 : aiQ >= 0.45 ? 1 : 0;
    this.myScore += myPts;
    this.aiScore += aiPts;
    const mineText = myPts === 2 ? "正中盾心!+2" : myPts === 1 ? "擦中盾牌 +1" : this.myQuality === null ? "沒出槍" : "落空";
    const theirsText = aiPts === 2 ? "對手正中 +2" : aiPts === 1 ? "對手擦中 +1" : "對手落空";
    this.lastResult = { mine: mineText, theirs: theirsText, myPts, aiPts };
    // 被擊中反應(無 KO:後仰+盾閃,不落馬)
    if (aiPts > 0) this.hitReactT = 0;
    if (myPts > 0) {
      this.aiHitReactT = 0;
      // 盾上閃光(對手盾=世界座標近似)
      this.hitFlash.position.set(-LANE_X + 0.3, 2.2, (this.myZ + this.aiZ) / 2);
      this.hitFlashT = 0;
    }
    this.emitEvent("pass-result", { pass: this.passNo, myPts, aiPts, myScore: this.myScore, aiScore: this.aiScore, mineText, theirsText });
    this.message = `${mineText}、${theirsText}(我 ${this.myScore}:${this.aiScore} 對手)`;
    this.phase = "reset";
    this.resetT = 0;
    this.pushHud();
  }

  finishMatch() {
    this.phase = "ended";
    const win = this.myScore > this.aiScore;
    const draw = this.myScore === this.aiScore;
    this.overlay = {
      visible: true,
      eyebrow: win ? "勝利!" : draw ? "平手" : "惜敗",
      title: `${this.myScore}:${this.aiScore}`,
      text: win
        ? "紅騎士獲勝!點到為止、贏得漂亮——真正的騎士精神!"
        : draw
          ? "勢均力敵!再來一場分高下!"
          : "這場讓對手拿下了——盯緊綠區、敢全速再衝一次!",
      canResume: false,
    };
    this.emitEvent("match-end", { win, draw, myScore: this.myScore, aiScore: this.aiScore });
    this.message = `比武結束——${this.myScore}:${this.aiScore}。`;
    this.saveGame(true);
    this.pushHud();
  }

  togglePause() {
    if (this.phase === "menu" || this.phase === "ended") return;
    if (this.overlay.visible) {
      this.resume();
    } else {
      this.overlay = { visible: true, eyebrow: "暫停中", title: "喘口氣", text: "整理盔甲,準備好再上場。", canResume: true };
      this.pushHud();
    }
  }

  resume() {
    if (!this.overlay.canResume) return;
    this.overlay.visible = false;
    this.pushHud();
  }

  cycleCameraView() {
    this.cameraView = (this.cameraView + 1) % 4;
    const names = ["跟隨視角", "側面轉播", "高空俯瞰", "馬上視角"];
    this.message = `視角:${names[this.cameraView]}。`;
    this.pushHud();
  }

  // ---------- 主迴圈 ----------
  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const tick = () => {
      if (!this.running) return;
      const delta = Math.min(this.clock.getDelta(), 0.05);
      this.update(delta);
      this.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height || 1.6;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  update(delta) {
    this.time += delta;
    const paused = this.overlay.visible;

    if (!paused && this.phase === "charging") {
      const preset = DIFFICULTY_PRESETS[this.difficulty];
      const boosting = this.input.isDown("up") || this.input.isDown("sprint");
      const slowing = this.input.isDown("down");
      const target = preset.baseSpeed + (boosting ? preset.boost : 0) - (slowing ? 2.0 : 0);
      this.speed += (Math.max(4, target) - this.speed) * Math.min(1, delta * 2.0);
      this.aiSpeed += (preset.baseSpeed + preset.boost * 0.55 - this.aiSpeed) * Math.min(1, delta * 2.0);
      this.myZ += this.speed * delta;
      this.aiZ -= this.aiSpeed * delta;
      this.gallopT += delta * (this.speed / 8);
      this.aiGallopT += delta * (this.aiSpeed / 8);

      // 交錯瞬間=結算(判定=畫面:分數在出槍當下已定,這裡演出來)
      if (this.aiZ - this.myZ <= 0.4) {
        this.resolvePass();
      }
    } else if (!paused && this.phase === "reset") {
      // 交錯後滑行減速 1.6s → 下一回合 / 終場
      this.resetT += delta;
      this.speed += (0 - this.speed) * Math.min(1, delta * 2.2);
      this.aiSpeed += (0 - this.aiSpeed) * Math.min(1, delta * 2.2);
      this.myZ += this.speed * delta;
      this.aiZ -= this.aiSpeed * delta;
      this.gallopT += delta * (this.speed / 8);
      this.aiGallopT += delta * (this.aiSpeed / 8);
      if (this.resetT >= 1.8) {
        const raceTo = this.mode.race;
        const duelOver = !this.mode.endless && !raceTo && this.passNo >= DIFFICULTY_PRESETS[this.difficulty].passes;
        const raceOver = raceTo && (this.myScore >= raceTo || this.aiScore >= raceTo);
        if (duelOver || raceOver) {
          this.finishMatch();
        } else {
          this.passNo += 1;
          this.beginPass();
        }
      }
    }

    // 擊中閃光
    this.hitFlashT += delta;
    if (this.hitFlashT < 0.5) {
      this.hitFlash.material.opacity = 0.9 * (1 - this.hitFlashT / 0.5);
      this.hitFlash.scale.setScalar(1 + this.hitFlashT * 2.2);
      this.hitFlash.lookAt(this.camera.position);
    } else {
      this.hitFlash.material.opacity = 0;
    }
    this.hitReactT += delta;
    this.aiHitReactT += delta;
    this.strikeAnimT += delta;

    this.handleKeys();
    this.updatePoses();
    this.updateCamera(delta);

    this.autoSaveTimer += delta;
    if (this.autoSaveTimer > 5) {
      this.autoSaveTimer = 0;
      this.saveGame(true);
    }

    this.input.endFrame();
    this.pushHud();
  }

  handleKeys() {
    if (this.input.consumePress("camera")) this.cycleCameraView();
    if (this.input.consumePress("pause")) this.togglePause();
    if (this.overlay.visible) return;
    if (this.input.consumePress("shoot")) this.strike();
  }

  updatePoses() {
    const animateHorse = (h, gallop, sp) => {
      const amp = clamp(sp / 14, 0, 0.62);
      const t = gallop * Math.PI * 2;
      const phases = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
      h.legs.forEach((leg, i) => {
        leg.pivot.rotation.x = Math.sin(t + phases[i]) * amp;
        leg.joint.rotation.x = Math.max(0, Math.sin(t + phases[i] + 0.8)) * amp * 1.3;
      });
      h.rig.position.y = Math.abs(Math.sin(t)) * amp * 0.14;
      h.neckPivot.rotation.x = Math.sin(t) * amp * 0.12;
      h.tail.rotation.x = 0.55 + Math.sin(t * 0.9) * 0.15;
    };
    animateHorse(this.myHorse, this.gallopT, this.speed);
    animateHorse(this.aiHorse, this.aiGallopT, this.aiSpeed);
    this.myHorse.group.position.z = this.myZ;
    this.aiHorse.group.position.z = this.aiZ;

    // 我方騎士:衝鋒=槍口平舉(couch);出槍瞬間前刺;被擊中=後仰(無 KO 苦臉反應)
    const gap = this.aiZ - this.myZ;
    const couch = this.phase === "charging" && gap <= ARM_RANGE;
    // 出槍前刺:0.3 秒內 -0.6 → -1.5 再回
    let thrust = 0;
    if (this.strikeAnimT < 0.16) thrust = this.strikeAnimT / 0.16;
    else if (this.strikeAnimT < 0.45) thrust = 1 - (this.strikeAnimT - 0.16) / 0.29;
    this.me.rightArm.pivot.rotation.x = couch || this.armed ? -1.35 - thrust * 0.25 : -1.05;
    this.me.rightArm.joint.rotation.x = couch || this.armed ? -0.15 - thrust * 0.2 : -0.6;
    this.me.leftArm.pivot.rotation.x = -0.9; // 持盾護胸
    this.me.leftArm.pivot.rotation.z = 0.35;
    this.me.rig.rotation.x = this.hitReactT < 0.8 ? -0.55 * (1 - this.hitReactT / 0.8) : (this.phase === "charging" ? 0.12 : 0);
    // 對手鏡像
    const aiCouch = this.phase === "charging" && gap <= ARM_RANGE;
    this.ai.rightArm.pivot.rotation.x = aiCouch ? -1.35 : -1.05;
    this.ai.rightArm.joint.rotation.x = aiCouch ? -0.15 : -0.6;
    this.ai.leftArm.pivot.rotation.x = -0.9;
    this.ai.leftArm.pivot.rotation.z = 0.35;
    this.ai.rig.rotation.x = this.aiHitReactT < 0.8 ? -0.55 * (1 - this.aiHitReactT / 0.8) : (this.phase === "charging" ? 0.12 : 0);
  }

  updateCamera(delta) {
    let desiredPos;
    let desiredLook;
    if (this.phase === "menu") {
      const a = this.time * 0.08;
      desiredPos = new THREE.Vector3(Math.cos(a) * 34, 11, Math.sin(a) * 34);
      desiredLook = new THREE.Vector3(0, 1.2, 0);
    } else if (this.cameraView === 0) {
      // 跟隨玩家後上方,看向對手來向
      desiredPos = new THREE.Vector3(LANE_X + 2.4, 4.2, this.myZ - 8.5);
      desiredLook = new THREE.Vector3(0, 1.7, this.myZ + 12);
    } else if (this.cameraView === 1) {
      const mid = (this.myZ + this.aiZ) / 2;
      desiredPos = new THREE.Vector3(11, 3.4, mid);
      desiredLook = new THREE.Vector3(0, 1.5, mid);
    } else if (this.cameraView === 2) {
      const mid = (this.myZ + this.aiZ) / 2;
      desiredPos = new THREE.Vector3(4, 26, mid);
      desiredLook = new THREE.Vector3(0, 0.5, mid);
    } else {
      desiredPos = new THREE.Vector3(LANE_X, 2.9, this.myZ - 0.4);
      desiredLook = new THREE.Vector3(-LANE_X * 0.4, 1.8, this.myZ + 14);
    }
    const k = 1 - Math.exp(-delta * 3.4);
    this.camPos.lerp(desiredPos, k);
    this.camLook.lerp(desiredLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  // ---------- HUD ----------
  pushHud() {
    if (!this.onHudUpdate) return;
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const gap = this.aiZ - this.myZ;
    // 出槍時機條:對手進 ARM_RANGE 內開始充,到理想出槍點=滿;err<window=綠區
    let approach01 = 0;
    let inWindow = false;
    if (this.phase === "charging" && !this.armed && gap <= ARM_RANGE) {
      approach01 = clamp(1 - (gap - STRIKE_IDEAL) / (ARM_RANGE - STRIKE_IDEAL), 0, 1);
      const closing = Math.max(this.speed + this.aiSpeed, 1);
      inWindow = Math.abs(gap - STRIKE_IDEAL) / closing <= preset.window;
    }
    const phaseLabels = { menu: "主選單", gate: "出發線", charging: "衝鋒", reset: "回合結算", ended: "終場" };
    const totalPasses = this.mode.race ? "∞" : this.mode.endless ? "∞" : preset.passes;
    this.onHudUpdate({
      myScore: this.myScore,
      aiScore: this.aiScore,
      passNo: this.passNo,
      totalPasses,
      modeLabel: this.mode.label,
      difficultyLabel: DIFFICULTY_LABELS[this.difficulty],
      phaseLabel: phaseLabels[this.phase] || "",
      message: this.message,
      speed01: clamp(this.speed / (preset.baseSpeed + preset.boost), 0, 1),
      speedText: `${(this.speed * 3.6).toFixed(0)} km/h`,
      approach01,
      inWindow,
      armed: this.armed,
      gapText: this.phase === "charging" ? `${Math.max(0, gap).toFixed(0)} m` : "—",
      lastResult: this.lastResult,
      overlay: { ...this.overlay },
    });
  }

  // ---------- 存讀檔(勝場紀錄) ----------
  saveGame(silent = false) {
    const prev = loadSavedGame() || {};
    const snapshot = { difficulty: this.difficulty, modeId: this.modeId, horseCoat: this.coatId, wins: prev.wins || 0, matches: prev.matches || 0 };
    if (this.phase === "ended" && !this.mode.endless) {
      snapshot.matches = (prev.matches || 0) + 1;
      if (this.myScore > this.aiScore) snapshot.wins = (prev.wins || 0) + 1;
    }
    saveGameState(snapshot);
    if (!silent) {
      this.message = "已存檔。";
      this.pushHud();
    }
  }

  loadGame() {
    const snap = loadSavedGame();
    if (!snap) return false;
    if (DIFFICULTY_PRESETS[snap.difficulty]) this.difficulty = snap.difficulty;
    if (GAME_MODES[snap.modeId]) {
      this.modeId = snap.modeId;
      this.mode = getModeConfig(snap.modeId);
    }
    if (HORSE_COATS[snap.horseCoat]) this.setHorseCoat(snap.horseCoat);
    this.openHomeMenu();
    this.message = snap.matches
      ? `戰績:${snap.wins} 勝 / ${snap.matches} 場——繼續衝!`
      : "尚無戰績,先來一場吧!";
    this.pushHud();
    return true;
  }
}
