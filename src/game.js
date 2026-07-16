import * as THREE from "three";
import { InputManager } from "./input.js";
import { loadSettings, saveSettings, loadSavedGame, saveGameState } from "./storage.js";

// —— 3D 騎士比武(jousting3d,德義武鬥館)——2026-07-16 大改版:自由騎控馬戰(武鬥制)。
// 使用者拍板:①兩騎自由走位——馬可前進/後退/原地轉向,不再只有單向對衝 ②拆掉中間分隔柵,
// 開放式競技場 ③血量條制:互相攻擊直到一方血量用完(「與 AI 騎士大戰三百回合」)④八般武器
// 可選+戰鬥中隨時更換:長槍/長矛/青龍大刀/騎士劍/彎刀/西洋劍/弓箭/雙綠鋼球。
// ★兒童安全鐵則不變:鈍頭武器、無流血;被擊中=盾閃+後仰苦臉;敗方=溫柔落馬演出(不受傷)。
// ★判定=畫面(鐵則4):出手當下用「距離+朝向」幾何判定,命中瞬間演出盾閃+慢動作。

// ---------- 可調量值 ----------
// maxFwd=馬最高前速;turnRate=轉向速率;aiSkill=AI 出手命中率;aiCd=AI 冷卻倍率;
// aiDmg=AI 傷害倍率;aiSpd=AI 馬速倍率;assist=兒童輔助(加傷害+放寬命中幾何)
// boost=衝刺加速(玩家限定,AI 沒有——按住 Shift/衝刺鈕逃跑用,07-16 使用者點名要跑更快)
export const DIFFICULTY_PRESETS = {
  kids: { maxFwd: 6.5, boost: 4.5, turnRate: 2.1, aiSkill: 0.25, aiCd: 1.9, aiDmg: 0.45, aiSpd: 0.75, assist: 0.5 },
  child: { maxFwd: 7.5, boost: 5.2, turnRate: 2.05, aiSkill: 0.4, aiCd: 1.5, aiDmg: 0.65, aiSpd: 0.85, assist: 0.3 },
  easy: { maxFwd: 8.5, boost: 6.0, turnRate: 1.95, aiSkill: 0.55, aiCd: 1.25, aiDmg: 0.8, aiSpd: 0.92, assist: 0.15 },
  normal: { maxFwd: 9.5, boost: 7.0, turnRate: 1.85, aiSkill: 0.68, aiCd: 1.05, aiDmg: 0.95, aiSpd: 1.0, assist: 0 },
  hard: { maxFwd: 10.5, boost: 7.5, turnRate: 1.8, aiSkill: 0.82, aiCd: 0.85, aiDmg: 1.1, aiSpd: 1.06, assist: 0 },
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
    hp: 100,
    description: "自由走位近身馬戰——用八般武器打光對手的血量條就獲勝!",
    goal: "打光對手血量(各 100)",
  },
  epic: {
    label: "大戰三百回合",
    hp: 300,
    roundCap: 300,
    description: "雙方 300 血的馬拉松大戰!戰滿三百回合仍未分勝負,以剩餘血量判定。",
    goal: "血量 300,戰到分出勝負",
  },
  practice: {
    label: "練習場",
    hp: 100,
    passive: true,
    description: "對手只走位不出手——自由練馬上走位與八般武器手感。",
    goal: "純練手感,不計勝負",
  },
};

export function getModeConfig(modeId) {
  return GAME_MODES[modeId] || GAME_MODES.duel;
}

// ---------- 八般武器(資料驅動;reach=出手距離、arc=正面判定角、cd=冷卻秒) ----------
export const WEAPON_ORDER = ["lance", "spear", "greatblade", "sword", "saber", "rapier", "bow", "greenballs"];

// swing=近戰揮擊型態(07-16 使用者點名動作要大):chop=180°舉過頭直劈、spin=360°迴旋橫掃、
// lunge=大幅回拉前刺;傷害在揮到對方身上那一刻(CONTACT_AT)才結算,判定仍在按下當下。
export const WEAPONS = {
  lance: { label: "騎士長槍", short: "長槍", reach: 3.4, dmg: 16, cd: 1.6, arc: 0.55, chargeBonus: 0.9, swing: "lunge", hint: "衝鋒加成最大,慢而重" },
  spear: { label: "長矛", short: "長矛", reach: 3.0, dmg: 12, cd: 1.1, arc: 0.65, chargeBonus: 0.5, swing: "lunge", hint: "長距直刺,攻守兼備" },
  greatblade: { label: "青龍大刀", short: "大刀", reach: 2.5, dmg: 15, cd: 1.5, arc: 1.6, swing: "spin", hint: "360° 迴旋橫掃,重擊" },
  sword: { label: "騎士劍", short: "劍", reach: 2.0, dmg: 10, cd: 0.8, arc: 1.25, swing: "chop", hint: "180° 直劈,均衡好上手" },
  saber: { label: "彎刀", short: "彎刀", reach: 1.9, dmg: 8, cd: 0.55, arc: 1.35, swing: "chop", hint: "180° 快劈連擊" },
  rapier: { label: "西洋劍", short: "西洋劍", reach: 2.2, dmg: 6, cd: 0.4, arc: 0.7, swing: "lunge", hint: "最快的點刺" },
  bow: { label: "弓箭", short: "弓箭", ranged: true, dmg: 9, cd: 1.5, projSpeed: 30, maxRange: 45, hint: "遠距狙擊(鈍頭箭)" },
  greenballs: { label: "雙綠鋼球", short: "鋼球", ranged: true, dmg: 6, cd: 2.4, projSpeed: 19, maxRange: 30, stun: 1.1, volley: 2, hint: "兩顆連投,命中讓對手暈一下" },
};

// 揮擊「接觸瞬間」(秒)——傷害/盾閃/慢動作在這一刻才發生,看得見打到身上
const CONTACT_AT = { chop: 0.24, spin: 0.3, lunge: 0.22 };

// 蓄力大招(07-16 使用者點名):長按出手鍵蓄力,放開發出「刀光/劍光/武器波動」飛行斬擊波。
// CHARGE_MIN=成招門檻(短按<此值=普通攻擊);CHARGE_FULL=滿蓄;被打會中斷蓄力。
const CHARGE_MIN = 0.6;
const CHARGE_FULL = 1.5;
const WAVE_COLORS = { chop: 0xfff3b0, spin: 0xff9a3d, lunge: 0x6fd8ff, bow: 0xffe14d, greenballs: 0x5aff6e };

// 自動面向敵人(07-16 使用者點名:轉向太花時間):敵人進此距離,玩家沒在手動轉向/衝刺時
// 自動把身體轉向對手;出手瞬間在攻距內更直接轉身面對再判定。
const AUTO_FACE_RANGE = 12;

// ---------- 競技場常數 ----------
const ARENA_HALF = 25; // 可騎乘範圍(±m)
const BODY_REACH = 1.1; // 馬身+臂展的基礎出手距離
const MAX_BACK = 2.6; // 馬倒退最高速
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

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

// ---------- 馬(長腿 v3+鬃毛三件套;coatMat/maneMat 可換色) ----------
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
      upperLen: 0.62, lowerLen: 0.6, upperRadius: 0.085, lowerRadius: 0.062, // 長腿 v3
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

// ---------- 騎士裝備:頭盔+羽飾+盾+八般武器(全部鈍頭/包棉演出,掛右手,切換顯示) ----------
function knightUp(person, teamColor, plumeColor) {
  const teamMat = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.6 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0xb9c0c8, metalness: 0.65, roughness: 0.35 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0xd9c9a8, roughness: 0.7 });
  const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x6d4a26, roughness: 0.7 });
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
  const crossMat = new THREE.MeshStandardMaterial({ color: 0xf5f0e0, roughness: 0.8 });
  const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.02), crossMat);
  crossV.position.z = 0.045;
  shield.add(crossV);
  const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.02), crossMat);
  crossH.position.z = 0.045;
  crossH.position.y = 0.08;
  shield.add(crossH);
  shield.position.set(0, -0.3, 0.12);
  person.leftArm.joint.add(shield);

  // —— 八般武器模型(全掛右手同一位置,visible 切換;一律朝 +z 出手) ——
  const weapons = {};
  const mount = (group) => {
    group.position.set(0, -0.28, 0.1);
    group.visible = false;
    person.rightArm.joint.add(group);
    return group;
  };

  { // 騎士長槍(鈍頭 coronel+護手錐)
    const lance = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.06, 3.1, 10), woodMat);
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
    const coronel = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), steelMat);
    coronel.position.z = 2.82;
    lance.add(coronel);
    weapons.lance = mount(lance);
  }
  { // 長矛(細長桿+葉形矛頭)
    const spear = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 2.8, 10), darkWoodMat);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = 1.1;
    spear.add(shaft);
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.42, 10), steelMat);
    blade.rotation.x = Math.PI / 2;
    blade.position.z = 2.66;
    spear.add(blade);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 10), teamMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.z = 2.42;
    spear.add(collar);
    weapons.spear = mount(spear);
  }
  { // 青龍大刀(長桿+寬彎刃+紅纓)
    const gd = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 2.2, 10), darkWoodMat);
    pole.rotation.x = Math.PI / 2;
    pole.position.z = 0.85;
    gd.add(pole);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.5, 0.95), steelMat);
    blade.position.set(0, 0.1, 2.3);
    blade.rotation.x = -0.18;
    gd.add(blade);
    const bladeTip = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 4), steelMat);
    bladeTip.rotation.x = Math.PI / 2;
    bladeTip.rotation.y = Math.PI / 4;
    bladeTip.position.set(0, 0.22, 2.85);
    gd.add(bladeTip);
    const tassel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.08), new THREE.MeshStandardMaterial({ color: 0xc23b22, roughness: 0.9 }));
    tassel.position.set(0, -0.16, 1.86);
    gd.add(tassel);
    weapons.greatblade = mount(gd);
  }
  { // 騎士劍(直刃+十字護手)
    const sword = new THREE.Group();
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8), darkWoodMat);
    grip.rotation.x = Math.PI / 2;
    grip.position.z = 0.05;
    sword.add(grip);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.06), steelMat);
    guard.position.z = 0.18;
    sword.add(guard);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.022, 1.45), steelMat);
    blade.position.z = 0.95;
    sword.add(blade);
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), teamMat);
    pommel.position.z = -0.08;
    sword.add(pommel);
    weapons.sword = mount(sword);
  }
  { // 彎刀(三段折角模擬弧刃)
    const saber = new THREE.Group();
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.2, 8), darkWoodMat);
    grip.rotation.x = Math.PI / 2;
    grip.position.z = 0.05;
    saber.add(grip);
    const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 12), steelMat);
    guard.rotation.x = Math.PI / 2;
    guard.position.z = 0.16;
    saber.add(guard);
    let ang = 0;
    let px = 0;
    for (let i = 0; i < 3; i += 1) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 0.5), steelMat);
      ang += 0.16;
      px += Math.sin(ang) * 0.5 * 0.5;
      seg.position.set(px, 0, 0.45 + i * 0.44);
      seg.rotation.y = ang;
      saber.add(seg);
    }
    weapons.saber = mount(saber);
  }
  { // 西洋劍(極細刃+杯型護手)
    const rapier = new THREE.Group();
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.18, 8), darkWoodMat);
    grip.rotation.x = Math.PI / 2;
    grip.position.z = 0.04;
    rapier.add(grip);
    const cup = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), steelMat);
    cup.rotation.x = -Math.PI / 2;
    cup.position.z = 0.16;
    rapier.add(cup);
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 1.7, 8), steelMat);
    blade.rotation.x = Math.PI / 2;
    blade.position.z = 1.05;
    rapier.add(blade);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), steelMat); // 鈍頭護尖
    tip.position.z = 1.92;
    rapier.add(tip);
    weapons.rapier = mount(rapier);
  }
  { // 弓箭(弓身弧+弦;箭發射時另生成)
    const bow = new THREE.Group();
    const arcMesh = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.03, 8, 20, Math.PI * 1.05), darkWoodMat);
    arcMesh.rotation.z = -Math.PI * 0.525 + Math.PI / 2;
    bow.add(arcMesh);
    const stringMesh = new THREE.Mesh(new THREE.BoxGeometry(0.012, 1.18, 0.012), new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.9 }));
    stringMesh.position.x = -0.08;
    bow.add(stringMesh);
    const gripWrap = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 8), teamMat);
    gripWrap.position.x = 0.6;
    bow.add(gripWrap);
    bow.rotation.y = Math.PI / 2; // 弓面朝前
    weapons.bow = mount(bow);
  }
  { // 雙綠鋼球(手握一顆+備用一顆;投出時另生成)
    const balls = new THREE.Group();
    const ballMat = new THREE.MeshStandardMaterial({ color: 0x2ecc40, metalness: 0.5, roughness: 0.3, emissive: 0x1a7a26, emissiveIntensity: 0.55 });
    const b1 = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 12), ballMat);
    b1.position.z = 0.22;
    balls.add(b1);
    const b2 = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 12), ballMat);
    b2.position.set(0.16, 0.05, 0.02);
    balls.add(b2);
    weapons.greenballs = mount(balls);
  }

  return { shield, weapons };
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
    this.weaponId = WEAPONS[settings.weaponId] ? settings.weaponId : "lance";

    this.input = new InputManager();
    this.input.bindTouchButtons(this.touchRoot);

    this.onHudUpdate = null;
    this.onEvent = null;

    this.running = false; // ★只給主迴圈 RAF 用
    this.time = 0;
    this.phase = "menu"; // menu | gate | battle | ended
    this.message = "在首頁選擇模式、難度與武器後開始。";
    this.cameraView = 0; // 0 跟隨 1 側面轉播 2 高空 3 馬上
    this.autoSaveTimer = 0;

    this.roundNo = 0; // 「回合」=雙方出手總次數(大戰三百回合!)
    this.lastHit = null; // {who, dmg, weapon} 顯示上一擊
    this.projectiles = [];
    this._pendingStrikes = []; // 近戰接觸瞬間結算佇列
    this._shotQueue = [];
    this.hitCamT = 9; // 命中慢動作/特寫計時
    this.endT = -1; // KO 落馬演出 → 終場

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
    this.camPos = new THREE.Vector3(4, 5, -24);
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

  // ---------- 場景:開放競技場(無分隔柵)+圍場欄+看台 ----------
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
    // 開放式比武沙場(方形大場地,中間不設任何阻擋)
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_HALF * 2 + 8, ARENA_HALF * 2 + 8), new THREE.MeshStandardMaterial({ color: 0xd2bd93, roughness: 1 }));
    sand.rotation.x = -Math.PI / 2;
    this.scene.add(sand);

    // 周邊圍場欄(只在場地邊界,場中央完全開放)
    const railMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.8 });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x6d4a26, roughness: 0.8 });
    const F = ARENA_HALF + 2.4;
    for (const [sx, sz, len, horizontal] of [
      [0, -F, F * 2, true],
      [0, F, F * 2, true],
      [-F, 0, F * 2, false],
      [F, 0, F * 2, false],
    ]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? len : 0.12, 0.1, horizontal ? 0.12 : len), railMat);
      rail.position.set(sx, 1.1, sz);
      this.scene.add(rail);
      const railLow = rail.clone();
      railLow.position.y = 0.6;
      this.scene.add(railLow);
      const count = 10;
      for (let i = 0; i <= count; i += 1) {
        const t = -len / 2 + (len / count) * i;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.3, 0.14), postMat);
        post.position.set(horizontal ? t : sx, 0.65, horizontal ? sz : t);
        this.scene.add(post);
      }
    }

    // 四角彩旗
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.8 });
    for (const cx of [-F, F]) {
      for (const cz of [-F, F]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.6, 8), poleMat);
        pole.position.set(cx, 1.8, cz);
        this.scene.add(pole);
        const flag = new THREE.Mesh(
          new THREE.PlaneGeometry(0.9, 0.5),
          new THREE.MeshStandardMaterial({ color: cx < 0 ? 0xb03030 : 0x2f5f9a, roughness: 0.85, side: THREE.DoubleSide }),
        );
        flag.position.set(cx + 0.5, 3.3, cz);
        this.scene.add(flag);
      }
    }
    // 沿邊彩旗
    for (let i = 0; i < 7; i += 1) {
      const z = -ARENA_HALF + i * (ARENA_HALF * 2 / 6);
      for (const side of [-1, 1]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8), poleMat);
        pole.position.set(side * (F + 1.2), 1.3, z);
        this.scene.add(pole);
        const pennant = new THREE.Mesh(
          new THREE.PlaneGeometry(0.55, 0.3),
          new THREE.MeshStandardMaterial({ color: i % 2 ? 0xf6d743 : (side < 0 ? 0xb03030 : 0x2f5f9a), roughness: 0.85, side: THREE.DoubleSide }),
        );
        pennant.position.set(side * (F + 1.2) + 0.3, 2.45, z);
        this.scene.add(pennant);
      }
    }

    // 觀眾看台(兩側,退到圍欄外)
    this.crowd = new THREE.Group();
    const standMat = new THREE.MeshStandardMaterial({ color: 0x6b7687, roughness: 0.85 });
    for (const side of [-1, 1]) {
      const stand = new THREE.Mesh(new THREE.BoxGeometry(5, 3.2, 70), standMat);
      stand.position.set(side * (F + 6.5), 1.6, 0);
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
        p.group.position.set(side * (F + 3.4), 0, -31 + i * 9);
        p.group.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2; // 臉朝比武場
        this.crowd.add(p.group);
      }
    }
    this.scene.add(this.crowd);

    // 我方:紅騎士;對手:藍騎士
    const coat = HORSE_COATS[this.coatId] || HORSE_COATS.brown;
    this.my = this.makeRider({
      coat: coat.coat, mane: coat.mane, caparison: 0xb03030,
      shirt: 0xb03030, pants: 0x5a2a2a, team: 0xb03030, plume: 0xf6d743,
    });
    this.foe = this.makeRider({
      coat: 0x4a4a52, mane: 0x1c1c22, caparison: 0x2f5f9a,
      shirt: 0x2f5f9a, pants: 0x24304a, team: 0x2f5f9a, plume: 0xf5f0e0,
    });
    this.foe.brain = { retreatT: 0, switchT: 5, orbitDir: 1 };

    this.setRiderWeapon(this.my, this.weaponId);
    this.setRiderWeapon(this.foe, "lance");

    // 擊中閃光(被擊者身上亮一圈)
    this.hitFlash = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.42, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0, side: THREE.DoubleSide }),
    );
    this.scene.add(this.hitFlash);
    this.hitFlashT = 9;

    this.resetRiders();
  }

  makeRider({ coat, mane, caparison, shirt, pants, team, plume }) {
    const horse = makeHorse({ coat, mane, caparison });
    this.scene.add(horse.group);
    const person = makePerson({ shirt, pants, scale: 0.95 });
    person.leftLeg.pivot.rotation.x = -1.25;
    person.leftLeg.pivot.rotation.z = 0.5;
    person.leftLeg.joint.rotation.x = 1.5;
    person.rightLeg.pivot.rotation.x = -1.25;
    person.rightLeg.pivot.rotation.z = -0.5;
    person.rightLeg.joint.rotation.x = 1.5;
    const gear = knightUp(person, team, plume);
    person.group.position.set(0, 0.82, 0.12);
    person.group.scale.setScalar(0.95);
    horse.rig.add(person.group);
    // 蓄力光圈(腳下金圈,蓄力時亮起放大)
    const chargeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.25, 28),
      new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0, side: THREE.DoubleSide }),
    );
    chargeRing.rotation.x = -Math.PI / 2;
    chargeRing.position.y = 0.06;
    horse.group.add(chargeRing);
    return {
      horse, person, gear, chargeRing,
      pos: new THREE.Vector3(), heading: 0, speed: 0,
      hp: 100, weaponId: "lance", cd: 0, chargeT: -1,
      strikeT: 9, hitT: 9, stunT: 9, koT: -1, gallopT: 0,
    };
  }

  resetRiders() {
    const hp = this.mode.hp || 100;
    for (const [rider, z, heading] of [[this.my, -14, 0], [this.foe, 14, Math.PI]]) {
      rider.pos.set(0, 0, z);
      rider.heading = heading;
      rider.speed = 0;
      rider.hp = hp;
      rider.cd = 0;
      rider.strikeT = 9;
      rider.hitT = 9;
      rider.stunT = 9;
      rider.koT = -1;
      rider.chargeT = -1;
      rider.person.group.rotation.z = 0;
      rider.person.group.position.set(0, 0.82, 0.12);
    }
    this.roundNo = 0;
    this.lastHit = null;
    this.endT = -1;
    this.hitCamT = 9;
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles = [];
    this._shotQueue = [];
    this._pendingStrikes = [];
    this.setRiderWeapon(this.my, this.weaponId);
    this.setRiderWeapon(this.foe, WEAPON_ORDER[Math.floor(Math.random() * 6)]); // AI 開場拿一把近戰
    if (this.foe.brain) {
      this.foe.brain.retreatT = 0;
      this.foe.brain.switchT = 5 + Math.random() * 4;
      this.foe.brain.orbitDir = Math.random() < 0.5 ? -1 : 1;
      this.foe.brain.superT = 8 + Math.random() * 6; // AI 大招節拍
      this.foe.brain.superHold = 0;
    }
    this.syncRiderTransforms();
    // 鏡頭硬切到玩家後方(lerp 穿場鐵則)
    const fwd = new THREE.Vector3(Math.sin(this.my.heading), 0, Math.cos(this.my.heading));
    this.camPos.copy(this.my.pos).addScaledVector(fwd, -8.5).setY(4.2);
    this.camLook.copy(this.my.pos).addScaledVector(fwd, 10).setY(1.6);
  }

  syncRiderTransforms() {
    for (const rider of [this.my, this.foe]) {
      rider.horse.group.position.set(rider.pos.x, 0, rider.pos.z);
      rider.horse.group.rotation.y = rider.heading;
    }
  }

  setRiderWeapon(rider, weaponId) {
    if (!WEAPONS[weaponId]) return;
    rider.weaponId = weaponId;
    for (const [id, model] of Object.entries(rider.gear.weapons)) {
      model.visible = id === weaponId;
    }
  }

  // 玩家換武器(選單/戰鬥中皆可;戰鬥中換=0.35s 小硬直,防連點)
  setPlayerWeapon(weaponId, announce = true) {
    if (!WEAPONS[weaponId] || this.my.weaponId === weaponId) return;
    this.setRiderWeapon(this.my, weaponId);
    this.weaponId = weaponId;
    if (this.phase === "battle") this.my.cd = Math.max(this.my.cd, 0.35);
    saveSettings({ difficulty: this.difficulty, modeId: this.modeId, horseCoat: this.coatId, weaponId });
    if (announce) {
      this.message = `換上${WEAPONS[weaponId].label}——${WEAPONS[weaponId].hint}!`;
      this.emitEvent("weapon-switch", { who: "me", label: WEAPONS[weaponId].label });
    }
    this.pushHud();
  }

  cyclePlayerWeapon() {
    const i = WEAPON_ORDER.indexOf(this.my.weaponId);
    this.setPlayerWeapon(WEAPON_ORDER[(i + 1) % WEAPON_ORDER.length]);
  }

  setHorseCoat(coatId) {
    if (!HORSE_COATS[coatId]) return;
    this.coatId = coatId;
    if (this.my) {
      this.my.horse.coatMat.color.setHex(HORSE_COATS[coatId].coat);
      this.my.horse.maneMat.color.setHex(HORSE_COATS[coatId].mane);
    }
  }

  // ---------- 輸入 ----------
  setupInput() {
    this.canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this._shootPress();
    });
    // 放開在 window 上聽:手指/滑鼠拖出畫布外也收得到
    window.addEventListener("pointerup", () => this._shootRelease());
    window.addEventListener("pointercancel", () => this._shootRelease());
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  // 按下出手:開戰/開始蓄力(短按放開=普攻,長按=大招)
  _shootPress() {
    if (this.overlay.visible) return;
    if (this.phase === "gate") {
      this.strike();
      return;
    }
    if (this.phase !== "battle" || this.my.koT >= 0 || this.endT >= 0) return;
    if (this.my.cd > 0 || this.my.stunT < this._stunDur()) return;
    if (this.my.chargeT < 0) this.my.chargeT = 0;
  }

  // 放開出手:蓄滿=大招(刀光/劍光/波動),沒蓄滿=普通攻擊
  _shootRelease() {
    if (this.my.chargeT < 0) return;
    const c = this.my.chargeT;
    this.my.chargeT = -1;
    if (this.phase !== "battle" || this.my.koT >= 0) return;
    if (c >= CHARGE_MIN) {
      this.superAttack(this.my, this.foe, clamp((c - CHARGE_MIN) / (CHARGE_FULL - CHARGE_MIN), 0, 1));
    } else {
      this.attack(this.my, this.foe);
    }
  }

  // ---------- 局面控制 ----------
  applyPresentation({ difficulty, modeId, horseCoat, weaponId }) {
    if (difficulty && DIFFICULTY_PRESETS[difficulty]) this.difficulty = difficulty;
    if (modeId && GAME_MODES[modeId]) {
      this.modeId = modeId;
      this.mode = getModeConfig(modeId);
    }
    if (horseCoat && HORSE_COATS[horseCoat]) this.setHorseCoat(horseCoat);
    if (weaponId && WEAPONS[weaponId]) {
      this.weaponId = weaponId;
      this.setRiderWeapon(this.my, weaponId);
    }
    saveSettings({ difficulty: this.difficulty, modeId: this.modeId, horseCoat: this.coatId, weaponId: this.weaponId });
    this.message = `${this.mode.label} · ${DIFFICULTY_LABELS[this.difficulty]} · ${WEAPONS[this.weaponId].label} 已設定。`;
    this.pushHud();
  }

  openHomeMenu() {
    this.phase = "menu";
    this.overlay.visible = false;
    this.message = "在首頁選擇模式、難度與武器後開始。";
    this.pushHud();
  }

  startSelectedMatch() {
    this.resetRiders();
    this.phase = "gate";
    this.message = "點畫面(或空白鍵)開戰!W/S 前進後退、A/D 轉向,1-8 或 Q 換武器。";
    this.emitEvent("match-start", { mode: this.mode.label });
    this.pushHud();
  }

  // 出手/開戰共用(點畫面/空白鍵)
  strike() {
    if (this.overlay.visible) return;
    if (this.phase === "gate") {
      this.phase = "battle";
      this.emitEvent("battle-start", {});
      this.message = "開戰!自由走位,靠近時看準時機出手!";
      this.pushHud();
      return;
    }
    if (this.phase !== "battle" || this.my.koT >= 0) return;
    this.attack(this.my, this.foe);
  }

  // ---------- 戰鬥核心(玩家/AI 共用同一條路徑:同規則原則) ----------
  attack(rider, target) {
    if (this.phase !== "battle" || this.endT >= 0) return;
    if (rider.cd > 0 || rider.stunT < (this._stunDur(rider) || 0) || rider.koT >= 0) return;
    const w = WEAPONS[rider.weaponId];
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const isPlayer = rider === this.my;
    rider.cd = w.cd * (isPlayer ? 1 : preset.aiCd);
    rider.strikeT = 0;
    this.roundNo += 1;

    // 出手瞬間自動轉向(玩家輔助):對手在攻距內就先把身體轉向他再判定,不用手動對準
    if (isPlayer) {
      const snapDist = rider.pos.distanceTo(target.pos);
      const inSnapRange = w.ranged ? snapDist <= w.maxRange : snapDist <= w.reach + BODY_REACH + 1.2;
      if (inSnapRange) rider.heading = Math.atan2(target.pos.x - rider.pos.x, target.pos.z - rider.pos.z);
    }

    if (w.ranged) {
      const volley = w.volley || 1;
      for (let i = 0; i < volley; i += 1) {
        this._queueShot(rider, target, w, i * 0.18);
      }
      this.emitEvent("shoot", { who: isPlayer ? "me" : "ai", weapon: w.label });
      if (isPlayer) this.message = `${w.label}出手!`;
      this.pushHud();
      return;
    }

    // 近戰:距離+朝向幾何判定(判定=畫面)
    const dist = rider.pos.distanceTo(target.pos);
    const assist = isPlayer ? preset.assist : 0;
    const reach = w.reach + BODY_REACH + assist * 0.8;
    const toTarget = Math.atan2(target.pos.x - rider.pos.x, target.pos.z - rider.pos.z);
    const facing = Math.abs(wrapAngle(toTarget - rider.heading)) <= w.arc + assist * 0.5;
    let lands = dist <= reach && facing;
    // AI 命中率門檻(擬人:就算站對位置也會有失手)
    if (lands && !isPlayer && Math.random() > clamp(preset.aiSkill + 0.18, 0, 0.95)) lands = false;
    if (lands) {
      let dmg = w.dmg;
      if (w.chargeBonus) dmg *= 1 + w.chargeBonus * clamp(Math.abs(rider.speed) / preset.maxFwd, 0, 1);
      dmg *= isPlayer ? 1 + assist * 0.6 : preset.aiDmg;
      // 判定在按下當下,傷害延到「揮到對方身上」的接觸瞬間才結算(動作看得見打中)
      this._pendingStrikes.push({
        target,
        dmg: Math.round(dmg),
        opts: { who: isPlayer ? "me" : "ai", weapon: w, stun: 0 },
        t: CONTACT_AT[w.swing] || 0.2,
      });
    } else {
      this.emitEvent("miss", { who: isPlayer ? "me" : "ai" });
      if (isPlayer) {
        this.message = dist > reach ? "太遠了——再靠近一點出手!" : "沒對準——把馬頭轉向對手再出手!";
        this.pushHud();
      }
    }
  }

  _stunDur() {
    return 1.1; // 鋼球暈眩秒數(stunT < 此值=暈眩中)
  }

  // ---------- 蓄力大招:放出「刀光/劍光/武器波動」飛行斬擊波 ----------
  superAttack(rider, target, charge01) {
    if (this.phase !== "battle" || this.endT >= 0 || rider.koT >= 0) return;
    const w = WEAPONS[rider.weaponId];
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const isPlayer = rider === this.my;
    rider.cd = w.cd * 2.2 * (isPlayer ? 1 : preset.aiCd); // 大招冷卻加倍
    rider.strikeT = 0; // 播大揮擊動畫
    this.roundNo += 1;
    // 大招自動瞄準(玩家輔助):波動朝敵人方向發出
    if (isPlayer && rider.pos.distanceTo(target.pos) <= 28) {
      rider.heading = Math.atan2(target.pos.x - rider.pos.x, target.pos.z - rider.pos.z);
    }
    let dmg = w.dmg * (1.4 + 1.1 * charge01); // 蓄越滿越痛(1.4x~2.5x)
    dmg *= isPlayer ? 1 + preset.assist * 0.6 : preset.aiDmg;
    this._fireWave(rider, target, w, Math.round(dmg));
    this.emitEvent("super", { who: isPlayer ? "me" : "ai", weapon: w.label });
    this.message = isPlayer
      ? `蓄力大招——${w.label}波動出鞘!`
      : `對手放出${w.label}大招波動——快閃開!`;
    this.pushHud();
  }

  _fireWave(rider, target, w, dmg) {
    // 斬擊波:發光新月弧,沿馬頭朝向直飛(垂直=劈系劍光,水平=迴旋刀光)
    const color = WAVE_COLORS[w.swing] || WAVE_COLORS[rider.weaponId] || 0xfff3b0;
    const wave = new THREE.Group();
    const arcMesh = new THREE.Mesh(
      new THREE.TorusGeometry(1.35, 0.18, 10, 26, Math.PI * 0.95),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 }),
    );
    arcMesh.rotation.z = Math.PI * 0.03;
    const glow = new THREE.Mesh(
      new THREE.TorusGeometry(1.35, 0.44, 10, 26, Math.PI * 0.95),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 }),
    );
    glow.rotation.z = Math.PI * 0.03;
    wave.add(arcMesh);
    wave.add(glow);
    if (w.swing === "spin") wave.rotation.z = Math.PI / 2; // 橫掃=水平刀光
    const fwd = new THREE.Vector3(Math.sin(rider.heading), 0, Math.cos(rider.heading));
    wave.position.copy(rider.pos).setY(2.0).addScaledVector(fwd, 1.4);
    wave.rotation.y = rider.heading;
    this.scene.add(wave);
    this.projectiles.push({
      mesh: wave, vel: fwd.multiplyScalar(16), t: 0,
      dmg, stun: rider.weaponId === "greenballs" ? 1.4 : 0,
      target,
      who: rider === this.my ? "me" : "ai",
      weapon: w,
      isWave: true, hitR: 1.8, life: 1.3,
    });
  }

  _queueShot(rider, target, w, delay) {
    // 由 update 消化的延遲發射佇列(雙鋼球兩顆連投)
    this._shotQueue = this._shotQueue || [];
    this._shotQueue.push({ rider, target, w, t: delay });
  }

  _fireProjectile(rider, target, w) {
    if (rider.koT >= 0 || this.phase !== "battle") return;
    const isPlayer = rider === this.my;
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const from = rider.pos.clone().setY(2.0);
    const fwdOffset = new THREE.Vector3(Math.sin(rider.heading), 0, Math.cos(rider.heading));
    from.addScaledVector(fwdOffset, 0.8);
    // 瞄準:預測目標移動(玩家=自動輔瞄;AI 依 aiSkill 加誤差)
    const targetPoint = target.pos.clone().setY(1.8);
    const dist = from.distanceTo(targetPoint);
    const flight = dist / w.projSpeed;
    const targetVel = new THREE.Vector3(Math.sin(target.heading), 0, Math.cos(target.heading)).multiplyScalar(target.speed);
    targetPoint.addScaledVector(targetVel, flight * (isPlayer ? 0.85 : preset.aiSkill));
    if (!isPlayer) {
      const err = (1 - preset.aiSkill) * 3.2;
      targetPoint.x += (Math.random() * 2 - 1) * err;
      targetPoint.z += (Math.random() * 2 - 1) * err;
    }
    const dir = targetPoint.clone().sub(from).normalize();
    const vel = dir.multiplyScalar(w.projSpeed);

    let mesh;
    if (rider.weaponId === "greenballs") {
      vel.y += 2.2; // 拋物線投擲
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0x2ecc40, metalness: 0.5, roughness: 0.3, emissive: 0x1a7a26, emissiveIntensity: 0.6 }),
      );
    } else {
      mesh = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0x8a6a3c, roughness: 0.8 }));
      shaft.rotation.x = Math.PI / 2;
      mesh.add(shaft);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), new THREE.MeshStandardMaterial({ color: 0xb9c0c8, metalness: 0.6, roughness: 0.4 })); // 鈍頭箭
      tip.position.z = 0.48;
      mesh.add(tip);
      const fletch = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.14), new THREE.MeshStandardMaterial({ color: isPlayer ? 0xb03030 : 0x2f5f9a, roughness: 0.9 }));
      fletch.position.z = -0.42;
      mesh.add(fletch);
      mesh.lookAt(mesh.position.clone().add(vel));
    }
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh, vel, t: 0,
      dmg: Math.round(w.dmg * (isPlayer ? 1 + preset.assist * 0.6 : preset.aiDmg)),
      stun: w.stun || 0,
      target,
      who: isPlayer ? "me" : "ai",
      weapon: w,
      isBall: rider.weaponId === "greenballs",
    });
  }

  applyHit(target, dmg, { who, weapon, stun }) {
    if (this.phase !== "battle" || target.koT >= 0 || this.endT >= 0) return;
    target.hp = Math.max(0, target.hp - dmg);
    target.hitT = 0;
    if (stun) target.stunT = 0;
    target.chargeT = -1; // 被打中斷蓄力(反制大招的方法)
    // 撞退一小步(打擊感,幅度小,兒童安全)
    target.speed *= 0.4;
    this.hitFlash.position.copy(target.pos).setY(1.9);
    this.hitFlash.material.color.setHex(stun ? 0x6dff7a : 0xffe14d);
    this.hitFlashT = 0;
    this.hitCamT = 0;
    const isMe = who === "me";
    this.lastHit = { who, dmg, weapon: weapon.short };
    this.emitEvent("hit", {
      who, dmg, weapon: weapon.label, stun: !!stun,
      myHp: this.my.hp, aiHp: this.foe.hp, round: this.roundNo,
    });
    this.message = isMe
      ? `${weapon.label}命中!對手 -${dmg}${stun ? "(暈眩!)" : ""}`
      : `被對手的${weapon.label}擊中 -${dmg}${stun ? "(暈眩!)" : ""}——拉開距離再反擊!`;
    if (target.hp <= 0) {
      target.koT = 0;
      this.endT = 0; // 溫柔落馬演出後結算
      this.emitEvent("ko", { winner: isMe ? "me" : "ai" });
    }
    this.pushHud();
  }

  finishMatch() {
    this.phase = "ended";
    const win = this.foe.hp <= 0 && this.my.hp > 0;
    const draw = this.my.hp === this.foe.hp;
    const byRounds = this.mode.roundCap && this.roundNo >= this.mode.roundCap && this.my.hp > 0 && this.foe.hp > 0;
    const rWin = byRounds ? this.my.hp > this.foe.hp : win;
    this.overlay = {
      visible: true,
      eyebrow: rWin ? "勝利!" : draw ? "平手" : "惜敗",
      title: byRounds ? `三百回合戰滿 ${this.my.hp}:${this.foe.hp}` : rWin ? "紅騎士獲勝!" : "藍騎士獲勝!",
      text: rWin
        ? `大戰 ${this.roundNo} 回合,紅騎士技高一籌!鈍頭武器點到為止——真正的騎士精神!`
        : draw
          ? "勢均力敵!換一把武器再來一場!"
          : `大戰 ${this.roundNo} 回合,這場讓對手拿下了——記得多走位、看準冷卻好了再出手!`,
      canResume: false,
    };
    this.emitEvent("match-end", { win: rWin, draw, myHp: this.my.hp, aiHp: this.foe.hp, rounds: this.roundNo });
    this.message = `比武結束——大戰 ${this.roundNo} 回合。`;
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

    // 命中瞬間慢動作(0.4s,打擊感)
    this._slowMo = !paused && this.hitCamT < 0.4 ? 0.42 : 1;
    const sdt = delta * this._slowMo;

    if (!paused && this.phase === "battle") {
      this.updatePlayerMovement(sdt);
      this.updateAi(sdt); // 練習場 AI 仍走位(只是不出手)
      this.updateProjectiles(sdt);
      this.resolveBodyPush();
      this.syncRiderTransforms();

      // 三百回合戰滿判定(epic)
      if (this.mode.roundCap && this.roundNo >= this.mode.roundCap && this.endT < 0 && this.my.hp > 0 && this.foe.hp > 0) {
        this.endT = 0.01; // 直接進結算(無落馬)
      }
      // KO 落馬演出 → 終場
      if (this.endT >= 0) {
        this.endT += delta;
        if (this.endT >= 1.6) this.finishMatch();
      }
    }

    // 擊中閃光
    this.hitFlashT += sdt;
    if (this.hitFlashT < 0.5) {
      this.hitFlash.material.opacity = 0.9 * (1 - this.hitFlashT / 0.5);
      this.hitFlash.scale.setScalar(1 + this.hitFlashT * 2.2);
      this.hitFlash.lookAt(this.camera.position);
    } else {
      this.hitFlash.material.opacity = 0;
    }
    this.hitCamT += delta;
    for (const rider of [this.my, this.foe]) {
      rider.hitT += sdt;
      rider.stunT += sdt;
      rider.strikeT += sdt;
      rider.cd = Math.max(0, rider.cd - sdt);
      if (rider.koT >= 0) rider.koT += delta;
      if (rider.chargeT >= 0 && this.phase === "battle" && !paused) {
        rider.chargeT = Math.min(CHARGE_FULL, rider.chargeT + sdt);
      }
    }

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

  updatePlayerMovement(dt) {
    const rider = this.my;
    if (rider.koT >= 0) {
      rider.speed += (0 - rider.speed) * Math.min(1, dt * 3);
      this.movePos(rider, dt);
      return;
    }
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const stunned = rider.stunT < this._stunDur();
    let target = 0;
    if (!stunned) {
      if (this.input.isDown("up")) target = preset.maxFwd + (this.input.isDown("sprint") ? preset.boost : 0);
      else if (this.input.isDown("down")) target = rider.speed > 0.6 ? 0 : -MAX_BACK;
      if (rider.chargeT >= 0) target *= 0.5; // 蓄力中放慢(大招有重量感)
      const turn = (this.input.isDown("left") ? 1 : 0) - (this.input.isDown("right") ? 1 : 0);
      rider.heading += turn * preset.turnRate * dt;
      // 自動面向敵人:近距離自動轉身對準;手動轉向(A/D)或衝刺逃跑時不干預;
      // 高速背對(騎馬離開)也不硬拉回來,只有慢下來纏鬥時才鎖定
      if (turn === 0 && !this.input.isDown("sprint") && this.foe.koT < 0) {
        const dxF = this.foe.pos.x - rider.pos.x;
        const dzF = this.foe.pos.z - rider.pos.z;
        const distF = Math.hypot(dxF, dzF);
        if (distF <= AUTO_FACE_RANGE) {
          const diff = wrapAngle(Math.atan2(dxF, dzF) - rider.heading);
          if (Math.abs(diff) <= 2.0 || Math.abs(rider.speed) < preset.maxFwd * 0.45) {
            const maxTurn = preset.turnRate * 1.15 * dt;
            rider.heading += clamp(diff, -maxTurn, maxTurn);
          }
        }
      }
    }
    const rate = target < rider.speed ? 4.5 : 2.6; // 煞車比加速快
    rider.speed += (target - rider.speed) * Math.min(1, dt * rate);
    this.movePos(rider, dt);
    rider.gallopT += dt * (Math.abs(rider.speed) / 8);
  }

  movePos(rider, dt) {
    rider.pos.x += Math.sin(rider.heading) * rider.speed * dt;
    rider.pos.z += Math.cos(rider.heading) * rider.speed * dt;
    // 場邊圍欄:柔性擋住(不反彈,速度衰減)
    const nx = clamp(rider.pos.x, -ARENA_HALF, ARENA_HALF);
    const nz = clamp(rider.pos.z, -ARENA_HALF, ARENA_HALF);
    if (nx !== rider.pos.x || nz !== rider.pos.z) rider.speed *= 0.5;
    rider.pos.x = nx;
    rider.pos.z = nz;
  }

  // 兩馬不重疊(輕推開,防穿模)
  resolveBodyPush() {
    const dx = this.foe.pos.x - this.my.pos.x;
    const dz = this.foe.pos.z - this.my.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.01 && d < 1.7) {
      const push = (1.7 - d) / 2;
      const ux = dx / d;
      const uz = dz / d;
      this.my.pos.x -= ux * push;
      this.my.pos.z -= uz * push;
      this.foe.pos.x += ux * push;
      this.foe.pos.z += uz * push;
    }
  }

  // ---------- AI 騎士(npc-ai-kit 對手 AI 三式:擬人走位+換武器+出手) ----------
  updateAi(dt) {
    const rider = this.foe;
    if (rider.koT >= 0) {
      rider.speed += (0 - rider.speed) * Math.min(1, dt * 3);
      this.movePos(rider, dt);
      return;
    }
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const brain = rider.brain;
    const stunned = rider.stunT < this._stunDur();
    const w = WEAPONS[rider.weaponId];
    const dx = this.my.pos.x - rider.pos.x;
    const dz = this.my.pos.z - rider.pos.z;
    const dist = Math.hypot(dx, dz);
    const toPlayer = Math.atan2(dx, dz);

    // 換武器腦(依距離挑合適的;練習場也會換,增加觀賞性)
    brain.switchT -= dt;
    if (brain.switchT <= 0) {
      brain.switchT = 6 + Math.random() * 5;
      const melee = ["lance", "spear", "greatblade", "sword", "saber", "rapier"];
      const rangedW = ["bow", "greenballs"];
      let pick;
      if (dist > 12) pick = Math.random() < 0.7 ? rangedW[Math.floor(Math.random() * 2)] : melee[Math.floor(Math.random() * 6)];
      else if (dist < 7) pick = melee[Math.floor(Math.random() * 6)];
      else pick = Math.random() < 0.35 ? rangedW[Math.floor(Math.random() * 2)] : melee[Math.floor(Math.random() * 6)];
      if (pick !== rider.weaponId) {
        this.setRiderWeapon(rider, pick);
        rider.cd = Math.max(rider.cd, 0.4);
        this.emitEvent("weapon-switch", { who: "ai", label: WEAPONS[pick].label });
      }
    }

    // 走位腦
    let desiredHeading = toPlayer;
    let desiredSpeed = preset.maxFwd * preset.aiSpd;
    if (brain.retreatT > 0) {
      brain.retreatT -= dt;
      desiredHeading = toPlayer + Math.PI + brain.orbitDir * 0.5;
      desiredSpeed = preset.maxFwd * preset.aiSpd * 0.85;
    } else if (w.ranged) {
      if (dist < 8) {
        desiredHeading = toPlayer + Math.PI; // 拉開距離
        desiredSpeed = preset.maxFwd * preset.aiSpd * 0.8;
      } else if (dist > 16) {
        desiredSpeed = preset.maxFwd * preset.aiSpd * 0.9;
      } else {
        desiredHeading = toPlayer + (Math.PI / 2) * brain.orbitDir; // 繞圈保持距離
        desiredSpeed = preset.maxFwd * preset.aiSpd * 0.45;
      }
    } else {
      // 近戰:追擊,近了收速方便對準
      desiredSpeed = dist > 8 ? preset.maxFwd * preset.aiSpd : dist > 4 ? preset.maxFwd * preset.aiSpd * 0.65 : preset.maxFwd * preset.aiSpd * 0.4;
    }
    // 快撞牆就先轉向場中央
    if (Math.abs(rider.pos.x) > ARENA_HALF - 3 || Math.abs(rider.pos.z) > ARENA_HALF - 3) {
      desiredHeading = Math.atan2(-rider.pos.x, -rider.pos.z);
    }
    if (stunned) desiredSpeed = 0;

    if (rider.chargeT >= 0) desiredSpeed *= 0.25; // AI 蓄力時明顯減速=玩家的閃避/打斷窗

    const angDiff = wrapAngle(desiredHeading - rider.heading);
    const maxTurn = preset.turnRate * preset.aiSpd * dt;
    rider.heading += clamp(angDiff, -maxTurn, maxTurn);
    rider.speed += (desiredSpeed * clamp(1 - Math.abs(angDiff) / Math.PI, 0.25, 1) - rider.speed) * Math.min(1, dt * 2.4);
    this.movePos(rider, dt);
    rider.gallopT += dt * (Math.abs(rider.speed) / 8);

    // 大招腦:定時蓄力放波動(蓄力有預告,玩家可閃可打斷)
    brain.superT -= dt;
    if (rider.chargeT >= 0) {
      if (rider.chargeT >= brain.superHold) {
        const c01 = clamp((rider.chargeT - CHARGE_MIN) / (CHARGE_FULL - CHARGE_MIN), 0, 1);
        rider.chargeT = -1;
        this.superAttack(rider, this.my, c01);
      }
      return; // 蓄力中不做普攻
    }
    if (!this.mode.passive && !stunned && rider.cd <= 0 && brain.superT <= 0 && dist >= 5 && dist <= 18) {
      brain.superT = 9 + Math.random() * 7;
      brain.superHold = CHARGE_MIN + 0.35 + Math.random() * 0.5;
      rider.chargeT = 0;
      this.emitEvent("ai-charging", {});
      this.message = "對手在蓄力大招——快閃開或打斷他!";
      this.pushHud();
      return;
    }

    // 出手腦(練習場不出手)
    if (this.mode.passive || stunned || rider.cd > 0) return;
    const facingOk = Math.abs(wrapAngle(toPlayer - rider.heading)) <= (w.arc || 0.6) + 0.25;
    if (w.ranged) {
      if (dist >= 6 && dist <= w.maxRange * 0.85 && facingOk) {
        this.attack(rider, this.my);
      }
    } else if (dist <= w.reach + BODY_REACH && facingOk) {
      this.attack(rider, this.my);
      if (Math.random() < 0.35) {
        brain.retreatT = 1.2 + Math.random() * 1.0;
        brain.orbitDir = Math.random() < 0.5 ? -1 : 1;
      }
    }
  }

  updateProjectiles(dt) {
    // 近戰接觸瞬間結算(揮擊掃到對方身上那一刻)
    if (this._pendingStrikes && this._pendingStrikes.length) {
      for (const s of this._pendingStrikes) s.t -= dt;
      const landed = this._pendingStrikes.filter((s) => s.t <= 0);
      this._pendingStrikes = this._pendingStrikes.filter((s) => s.t > 0);
      for (const s of landed) this.applyHit(s.target, s.dmg, s.opts);
    }
    // 延遲發射佇列(雙鋼球第二顆)
    if (this._shotQueue && this._shotQueue.length) {
      for (const shot of this._shotQueue) shot.t -= dt;
      const due = this._shotQueue.filter((s) => s.t <= 0);
      this._shotQueue = this._shotQueue.filter((s) => s.t > 0);
      for (const s of due) this._fireProjectile(s.rider, s.target, s.w);
    }
    for (const p of this.projectiles) {
      p.t += dt;
      if (p.isWave) {
        // 斬擊波:直飛不落地,邊飛邊放大+旋轉刀光+脈動發光
        p.mesh.position.addScaledVector(p.vel, dt);
        const s = 1.15 + p.t * 0.8 + Math.sin(p.t * 18) * 0.06;
        p.mesh.scale.setScalar(s);
        for (const c of p.mesh.children) c.rotation.z += dt * 5.5; // 新月刀光旋轉,遠看也醒目
        p.mesh.children[1].material.opacity = 0.55 * (1 - (p.t / p.life) * 0.7);
      } else {
        p.vel.y -= (p.isBall ? 6.5 : 1.8) * dt;
        p.mesh.position.addScaledVector(p.vel, dt);
        if (!p.isBall) p.mesh.lookAt(p.mesh.position.clone().add(p.vel));
      }
      // 命中判定(只打對方;波動判定半徑較大)
      if (!p.done && p.target.koT < 0) {
        const chest = p.target.pos.clone().setY(p.isWave ? 2.0 : 1.8);
        if (p.mesh.position.distanceTo(chest) < (p.hitR || 1.25)) {
          p.done = true;
          p.remove = true;
          this.applyHit(p.target, p.dmg, { who: p.who, weapon: p.weapon, stun: p.stun });
        }
      }
      if (p.isWave ? p.t > p.life : (p.mesh.position.y <= 0.05 || p.t > 3.5)) p.remove = true;
    }
    for (const p of this.projectiles.filter((x) => x.remove)) this.scene.remove(p.mesh);
    this.projectiles = this.projectiles.filter((x) => !x.remove);
  }

  handleKeys() {
    if (this.input.consumePress("camera")) this.cycleCameraView();
    if (this.input.consumePress("pause")) this.togglePause();
    if (this.input.consumeRelease("shoot")) this._shootRelease(); // 放開一定要收到(即使暫停)
    if (this.overlay.visible) return;
    if (this.input.consumePress("shoot")) this._shootPress();
    if (this.input.consumePress("switch")) this.cyclePlayerWeapon();
    for (let i = 0; i < WEAPON_ORDER.length; i += 1) {
      if (this.input.consumePress(`weapon${i + 1}`)) this.setPlayerWeapon(WEAPON_ORDER[i]);
    }
  }

  updatePoses() {
    const animateHorse = (h, gallop, sp) => {
      const amp = clamp(Math.abs(sp) / 14, 0, 0.62);
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

    for (const rider of [this.my, this.foe]) {
      animateHorse(rider.horse, rider.gallopT, rider.speed);
      const w = WEAPONS[rider.weaponId];
      const person = rider.person;
      const other = rider === this.my ? this.foe : this.my;
      const dist = rider.pos.distanceTo(other.pos);
      const engaged = this.phase === "battle" && dist < 14;

      // —— 大揮擊動畫(07-16 二修:動作要大、看得見打到身上) ——
      // chop=180°舉過頭直劈;spin=360°上身迴旋橫掃;lunge=大幅回拉整枝前刺
      const st = rider.strikeT;
      const model = rider.gear.weapons[rider.weaponId];
      let armX = engaged ? -1.35 : -1.05; // 備戰持械位
      let armJ = engaged ? -0.15 : -0.6;
      let rigY = 0; // 上身水平旋轉(迴旋斬用)
      let strikeLean = 0; // 上身前壓(力道感)
      let weaponZ = 0.1;
      if (w.ranged) {
        armX = -1.35;
        armJ = -0.25;
        if (st < 0.45) armX -= 0.2 * (st < 0.16 ? st / 0.16 : 1 - (st - 0.16) / 0.29);
      } else if (st < 0.6) {
        if (w.swing === "chop") {
          if (st < 0.12) { // 舉過頭後方蓄力
            const k = st / 0.12;
            armX = -1.35 - k * 1.6;
          } else if (st < 0.3) { // 180° 全弧直劈到身前下方
            const k = (st - 0.12) / 0.18;
            armX = -2.95 + k * 2.6;
            armJ = -0.1 - k * 0.2;
            strikeLean = k * 0.3;
          } else { // 收回備戰位
            const k = (st - 0.3) / 0.3;
            armX = -0.35 - k * 1.0;
            armJ = -0.3 + k * 0.15;
            strikeLean = 0.3 * (1 - k);
          }
        } else if (w.swing === "spin") {
          armX = -1.5; // 手臂平舉,大刀橫置
          armJ = 0;
          if (st < 0.12) { // 起手反擰
            rigY = -(st / 0.12) * 0.5;
          } else if (st < 0.45) { // 上身整圈 360° 迴旋橫掃
            rigY = -0.5 - ((st - 0.12) / 0.33) * Math.PI * 2;
            strikeLean = 0.15;
          } else { // 收勢(−0.5−2π 與 −0.5 同向,直接從 −0.5 轉回 0)
            const k = (st - 0.45) / 0.15;
            rigY = -0.5 * (1 - k);
          }
        } else { // lunge:回拉蓄力 → 整枝大幅前刺 → 收回
          if (st < 0.1) {
            const k = st / 0.1;
            weaponZ = 0.1 - k * 0.45;
            armX = -1.35 + k * 0.25;
          } else if (st < 0.26) {
            const k = (st - 0.1) / 0.16;
            weaponZ = -0.35 + k * 2.35; // 前送超過 2m,整枝刺出去
            armX = -1.5;
            armJ = -0.05;
            strikeLean = k * 0.35;
          } else {
            const k = (st - 0.26) / 0.34;
            weaponZ = 2.0 - k * 1.9;
            armX = -1.4;
            strikeLean = 0.35 * (1 - k);
          }
        }
      }
      // 蓄力演出:武器高舉發抖+腳下金圈亮起放大(蓄越滿越亮)
      if (rider.chargeT >= 0) {
        const c01 = clamp(rider.chargeT / CHARGE_FULL, 0, 1);
        armX = -2.3 + Math.sin(this.time * 26) * 0.07 * (0.5 + c01);
        armJ = -0.1;
        rigY = 0;
        weaponZ = 0.1;
        rider.chargeRing.material.opacity = 0.25 + c01 * 0.6;
        rider.chargeRing.scale.setScalar(0.7 + c01 * 0.9);
      } else {
        rider.chargeRing.material.opacity = 0;
      }
      person.rightArm.pivot.rotation.x = armX;
      person.rightArm.joint.rotation.x = armJ;
      person.rig.rotation.y = rigY;
      if (model) model.position.z = weaponZ;

      person.leftArm.pivot.rotation.x = -0.9; // 持盾護胸
      person.leftArm.pivot.rotation.z = 0.35;

      // 被擊中=大後仰苦臉;暈眩=左右搖晃
      const stunned = rider.stunT < this._stunDur();
      if (rider.koT >= 0) {
        // 溫柔落馬:側滑下馬(演出,不受傷)
        const k = clamp(rider.koT / 1.2, 0, 1);
        person.group.rotation.z = k * 1.3;
        person.group.position.y = 0.82 - k * 0.45;
        person.group.position.x = k * 0.6;
      } else if (stunned) {
        person.rig.rotation.z = Math.sin(this.time * 10) * 0.12;
        person.rig.rotation.x = 0.1;
      } else {
        person.rig.rotation.z = 0;
        person.rig.rotation.x = rider.hitT < 0.8
          ? -0.8 * (1 - rider.hitT / 0.8)
          : Math.max(strikeLean, Math.abs(rider.speed) > 4 ? 0.12 : 0);
      }
    }
  }

  updateCamera(delta) {
    let desiredPos;
    let desiredLook;
    const mid = this.my.pos.clone().add(this.foe.pos).multiplyScalar(0.5);
    if (this.phase === "menu") {
      const a = this.time * 0.08;
      desiredPos = new THREE.Vector3(Math.cos(a) * 34, 11, Math.sin(a) * 34);
      desiredLook = new THREE.Vector3(0, 1.2, 0);
    } else if (this.hitCamT < 0.55 && this.phase === "battle") {
      // 命中特寫:兩騎連線的側面近景(慢動作配側拍)
      const dir = this.foe.pos.clone().sub(this.my.pos).setY(0).normalize();
      const perp = new THREE.Vector3(-dir.z, 0, dir.x);
      desiredPos = mid.clone().addScaledVector(perp, 7.5).setY(2.6);
      desiredLook = mid.clone().setY(1.8);
    } else if (this.cameraView === 0) {
      // 跟隨玩家後上方(隨馬頭朝向轉)
      const fwd = new THREE.Vector3(Math.sin(this.my.heading), 0, Math.cos(this.my.heading));
      desiredPos = this.my.pos.clone().addScaledVector(fwd, -8.2).setY(4.2);
      desiredLook = this.my.pos.clone().addScaledVector(fwd, 9).setY(1.6);
    } else if (this.cameraView === 1) {
      desiredPos = new THREE.Vector3(ARENA_HALF + 6, 4.2, clamp(mid.z, -18, 18));
      desiredLook = mid.clone().setY(1.5);
    } else if (this.cameraView === 2) {
      desiredPos = new THREE.Vector3(mid.x, 30, mid.z + 2);
      desiredLook = mid.clone().setY(0.5);
    } else {
      const fwd = new THREE.Vector3(Math.sin(this.my.heading), 0, Math.cos(this.my.heading));
      desiredPos = this.my.pos.clone().addScaledVector(fwd, 0.4).setY(2.9);
      desiredLook = this.my.pos.clone().addScaledVector(fwd, 14).setY(1.8);
    }
    const k = 1 - Math.exp(-delta * (this.hitCamT < 0.55 && this.phase !== "menu" ? 6.5 : 3.4));
    this.camPos.lerp(desiredPos, k);
    this.camLook.lerp(desiredLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  // ---------- HUD ----------
  pushHud() {
    if (!this.onHudUpdate) return;
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const w = WEAPONS[this.my.weaponId];
    const dist = this.my.pos.distanceTo(this.foe.pos);
    const ready01 = w.cd > 0 ? clamp(1 - this.my.cd / w.cd, 0, 1) : 1;
    const inReach = w.ranged
      ? dist >= 4 && dist <= w.maxRange
      : dist <= w.reach + BODY_REACH + preset.assist * 0.8;
    const phaseLabels = { menu: "主選單", gate: "出戰準備", battle: "激戰中", ended: "終場" };
    this.onHudUpdate({
      myHp: this.my.hp,
      aiHp: this.foe.hp,
      maxHp: this.mode.hp || 100,
      roundNo: this.roundNo,
      roundCap: this.mode.roundCap || null,
      modeLabel: this.mode.label,
      difficultyLabel: DIFFICULTY_LABELS[this.difficulty],
      phaseLabel: phaseLabels[this.phase] || "",
      message: this.message,
      speed01: clamp(Math.abs(this.my.speed) / (preset.maxFwd + preset.boost), 0, 1),
      speedText: `${(this.my.speed * 3.6).toFixed(0)} km/h`,
      weaponId: this.my.weaponId,
      weaponLabel: w.label,
      weaponShort: w.short,
      weaponHint: w.hint,
      weaponReady01: ready01,
      weaponReady: this.my.cd <= 0,
      charging: this.my.chargeT >= 0,
      charge01: this.my.chargeT >= 0 ? clamp(this.my.chargeT / CHARGE_FULL, 0, 1) : 0,
      chargeReady: this.my.chargeT >= CHARGE_MIN,
      inReach,
      gapText: this.phase === "battle" ? `${dist.toFixed(1)} m` : "—",
      lastHit: this.lastHit,
      overlay: { ...this.overlay },
    });
  }

  // ---------- 存讀檔(勝場紀錄) ----------
  saveGame(silent = false) {
    const prev = loadSavedGame() || {};
    const snapshot = {
      difficulty: this.difficulty, modeId: this.modeId, horseCoat: this.coatId, weaponId: this.weaponId,
      wins: prev.wins || 0, matches: prev.matches || 0,
    };
    if (this.phase === "ended" && !this.mode.passive) {
      snapshot.matches = (prev.matches || 0) + 1;
      if (this.foe.hp <= 0 && this.my.hp > 0) snapshot.wins = (prev.wins || 0) + 1;
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
    if (WEAPONS[snap.weaponId]) {
      this.weaponId = snap.weaponId;
      this.setRiderWeapon(this.my, snap.weaponId);
    }
    this.openHomeMenu();
    this.message = snap.matches
      ? `戰績:${snap.wins} 勝 / ${snap.matches} 場——繼續衝!`
      : "尚無戰績,先來一場吧!";
    this.pushHud();
    return true;
  }
}
