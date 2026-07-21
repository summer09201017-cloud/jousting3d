import * as THREE from "three";
import { InputManager } from "./input.js";
import { loadSettings, saveSettings, loadSavedGame, saveGameState } from "./storage.js";
import { animateIdleHead, animateCrowdCheer, EAR_SAFE_PHI } from "./idle-life.js";

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
// 07-16 再調弱 AI(使用者回饋:太黏拉不開):aiSpd 全檔下修——入門以下用走的就能拉開,
// AI 的反制是換遠程武器;aiCd 低檔位也放慢(出手更稀)。
export const DIFFICULTY_PRESETS = {
  kids: { maxFwd: 6.5, boost: 4.5, turnRate: 2.1, aiSkill: 0.25, aiCd: 2.3, aiDmg: 0.45, aiSpd: 0.5, assist: 0.5 },
  child: { maxFwd: 7.5, boost: 5.2, turnRate: 2.05, aiSkill: 0.4, aiCd: 1.9, aiDmg: 0.65, aiSpd: 0.58, assist: 0.3 },
  easy: { maxFwd: 8.5, boost: 6.0, turnRate: 1.95, aiSkill: 0.55, aiCd: 1.55, aiDmg: 0.8, aiSpd: 0.68, assist: 0.15 },
  normal: { maxFwd: 9.5, boost: 7.0, turnRate: 1.85, aiSkill: 0.68, aiCd: 1.2, aiDmg: 0.95, aiSpd: 0.82, assist: 0 },
  hard: { maxFwd: 10.5, boost: 7.5, turnRate: 1.8, aiSkill: 0.82, aiCd: 0.95, aiDmg: 1.1, aiSpd: 0.95, assist: 0 },
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

// 突進技(07-16 使用者點名):衝刺 ≥SPRINT_ARM 秒後按出手——
// 對手在遠距帶=「跳殺」(拋物線飛身躍撲,落地斬 1.6x);近距帶=「飛殺」(比衝刺更快的
// 1.8x 爆發突進,接觸斬 1.5x)。共用 TECH_CD 冷卻;玩家限定。
const SPRINT_ARM = 0.35;
const TECH_CD = 3.5;
const LEAP_RANGE = [8, 16]; // 跳殺距離帶
const DASH_RANGE = [3, 8]; // 飛殺距離帶

// 格擋(07-16 使用者點名):按住 K/C/舉盾鈕=舉盾——只擋正面 ±60°(BLOCK_ARC),
// 擋箭/鋼球=無傷;擋近戰=傷害×0.3;擋大招波動=傷害×0.3;舉盾瞬間 ≤PARRY_WINDOW 秒
// 內被近戰打到=完美盾反(無傷+對手彈開硬直)。舉盾中移速大減、不能出招。AI 也會舉盾。
const BLOCK_ARC = 1.05;
const PARRY_WINDOW = 0.35;

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

  // 頭+臉群組(idle-life 接線):樞紐=頭中心 2.12;各元件 y 用 H(y)=y−2.12 → 群組前後視覺零位移。
  // 轉頭時整顆頭連五官/耳/髮帽一起轉(idle 生動鐵則)。
  const HEAD_CENTER_Y = 2.12;
  const headGroup = new THREE.Group();
  headGroup.position.y = HEAD_CENTER_Y;
  rig.add(headGroup);
  const H = (y) => y - HEAD_CENTER_Y;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 18, 18), skinMat);
  head.position.y = H(2.12);
  headGroup.add(head);
  const earL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), skinMat);
  earL.scale.set(0.45, 1, 0.8);
  earL.position.set(-0.245, H(2.11), 0);
  headGroup.add(earL);
  const earR = earL.clone();
  earR.position.x = 0.245;
  headGroup.add(earR);

  // 耳前無髮鐵律:髮兩件式——①頭頂瓜皮帽(theta 0→0.32π,高於眉/眼/耳)
  // ②後腦半球用 EAR_SAFE_PHI(phi 1.06π~1.94π,前緣一律停在耳後);兩鬢與耳前露臉頰+耳朵。
  const hairMat = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.85 });
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.265, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.32), hairMat);
  hairCap.position.y = H(2.13);
  headGroup.add(hairCap);
  const hairBack = new THREE.Mesh(
    new THREE.SphereGeometry(0.255, 16, 8, EAR_SAFE_PHI.start, EAR_SAFE_PHI.end - EAR_SAFE_PHI.start, Math.PI * 0.3, Math.PI * (gender === "f" ? 0.43 : 0.27)),
    hairMat,
  );
  hairBack.position.y = H(2.12);
  headGroup.add(hairBack);

  const faceDark = new THREE.MeshBasicMaterial({ color: 0x25201a });
  const faceWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), faceWhite);
  eyeL.position.set(-0.09, H(2.18), 0.21);
  headGroup.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.09;
  headGroup.add(eyeR);
  const pupilL = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), faceDark);
  pupilL.position.set(-0.09, H(2.18), 0.25);
  headGroup.add(pupilL);
  const pupilR = pupilL.clone();
  pupilR.position.x = 0.09;
  headGroup.add(pupilR);
  const browL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.02), faceDark);
  browL.position.set(-0.09, H(2.26), 0.22);
  browL.rotation.z = 0.16;
  headGroup.add(browL);
  const browR = browL.clone();
  browR.position.x = 0.09;
  browR.rotation.z = -0.16;
  headGroup.add(browR);
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 8, 14, Math.PI), faceDark);
  smile.position.set(0, H(2.04), 0.21);
  smile.rotation.z = Math.PI;
  headGroup.add(smile);

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
  return { group, rig, head, headGroup, waist, leftArm, rightArm, leftLeg, rightLeg, smile };
}

// ---------- 可選角色(07-16 使用者點名,SBR 致敬皮,移植自 equestrian3d) ----------
// 選傑洛/喬尼時,對手自動變成「另一位」(兩人本來就是搭檔);預設=紅騎士 vs 藍騎士。
export const CHARACTERS = {
  default: { label: "紅騎士(預設)" },
  gyro: { label: "傑洛·齊貝林", shirt: 0x7a4db8, pants: 0x4a3a2e, hair: 0xe6c95c },
  johnny: { label: "喬尼·喬斯達", shirt: 0xf2f0ec, pants: 0xf2f0ec, hair: 0xe6c95c },
  diego: { label: "迪亞哥·布蘭度", shirt: 0x2f8f8a, pants: 0x24404c, hair: 0xe6c95c }, // 青綠騎師服+DIO 帽字(07-17 移植 equestrian nf21)
};
// 角色技能表(race-stage-kit ⑤):傑洛=鋼球已是第 8 號武器;喬尼=爪彈;迪亞哥=THE WORLD 時停
export const CHARACTER_SKILLS = {
  johnny: { label: "爪彈", cd: 8 },
  diego: { label: "THE WORLD", cd: 16 },
};

function makeStar(radius, color) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i += 1) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? radius : radius * 0.45;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
}

// 角色造型(掛在 makePerson 的 rig 上;帽簷停在眉上、鬍壓下顎線、星要突出帽面——07-15 三雷)
function makeCharacterPerson(charId, scale) {
  const spec = CHARACTERS[charId];
  const person = makePerson({ shirt: spec.shirt, pants: spec.pants, hair: spec.hair, gender: "f", scale });
  // 頭部裝飾一律掛 headGroup(轉頭時帽/鬍/髮綹跟著頭轉);HG 局部 y = 原 y − 2.12(頭中心)
  const HG = person.headGroup;
  const H = (y) => y - 2.12;
  const hairSideMat = new THREE.MeshStandardMaterial({ color: spec.hair, roughness: 0.85 });
  for (const x of [-0.21, 0.21]) {
    // 髮綹貼後腦(z=-0.03 起、往後收)——耳前無髮鐵律:不越過耳朵前緣
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.32, 0.14), hairSideMat);
    lock.position.set(x, H(1.97), -0.03);
    HG.add(lock);
  }
  if (charId === "johnny") {
    // 白色毛帽+帽上藍星+正面金馬蹄鐵+胸前藍星
    const capMat = new THREE.MeshStandardMaterial({ color: 0xf2f0ec, roughness: 0.7 });
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.268, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), capMat);
    cap.position.y = H(2.2);
    HG.add(cap);
    const horseshoe = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.016, 6, 12, Math.PI), new THREE.MeshBasicMaterial({ color: 0xd8a83c }));
    horseshoe.position.set(0, H(2.24), 0.28);
    horseshoe.rotation.x = -0.15;
    HG.add(horseshoe);
    for (const a of [-1.1, -0.55, 0.55, 1.1, Math.PI]) {
      const s = makeStar(0.05, 0x2f4fa8);
      const r = 0.28;
      s.position.set(Math.sin(a) * r, H(2.24), Math.cos(a) * r);
      s.rotation.order = "YXZ";
      s.rotation.y = a;
      s.rotation.x = -0.15;
      HG.add(s);
    }
    const chestStar = makeStar(0.1, 0x2f4fa8);
    chestStar.position.set(0, 1.54, 0.171);
    person.rig.add(chestStar);
  } else if (charId === "diego") {
    // 迪亞哥:青綠騎師帽(圓頂+前簷)+細 45° 交叉黃菱格+帽上黃色立體 DIO 字(equestrian nf21 定稿)
    const capMat = new THREE.MeshStandardMaterial({ color: 0x2f8f8a, roughness: 0.6 });
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.268, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), capMat);
    cap.position.y = H(2.2);
    HG.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.2), capMat);
    brim.position.set(0, H(2.2), 0.3);
    HG.add(brim);
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf6d743, roughness: 0.65 });
    for (const tilt of [Math.PI / 4, -Math.PI / 4]) {
      for (const sy of [1.16, 1.34, 1.52]) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.016, 0.345), stripeMat);
        stripe.position.set(0, sy, 0);
        stripe.rotation.z = tilt;
        person.rig.add(stripe);
      }
    }
    const dioMat = new THREE.MeshStandardMaterial({ color: 0xf6d743, roughness: 0.4, emissive: 0x6a5a10, emissiveIntensity: 0.5 });
    const dio = new THREE.Group();
    const dBar = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.11, 0.03), dioMat);
    dBar.position.set(-0.105, 0, 0);
    dio.add(dBar);
    const dArc = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.015, 8, 12, Math.PI), dioMat);
    dArc.rotation.z = -Math.PI / 2;
    dArc.position.set(-0.098, 0, 0);
    dio.add(dArc);
    const iBar = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.11, 0.03), dioMat);
    dio.add(iBar);
    const oRing = new THREE.Mesh(new THREE.TorusGeometry(0.044, 0.016, 8, 14), dioMat);
    oRing.position.set(0.098, 0, 0);
    dio.add(oRing);
    dio.position.set(0, H(2.315), 0.235);
    dio.rotation.x = -0.42;
    HG.add(dio);
  } else {
    // 傑洛:棕寬簷帽+深帽帶+下顎環鬍+金牙笑(原生嘴關掉,不然變雙嘴)+兩片綠披風
    person.smile.visible = false;
    const hatMat = new THREE.MeshStandardMaterial({ color: 0x6b4526, roughness: 0.75 });
    const bandMat = new THREE.MeshStandardMaterial({ color: 0x3e2a18, roughness: 0.6 });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.03, 18), hatMat);
    brim.position.y = H(2.26);
    HG.add(brim);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.218, 0.218, 0.07, 14), bandMat);
    band.position.y = H(2.3);
    HG.add(band);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.215, 0.22, 14), hatMat);
    crown.position.y = H(2.4);
    HG.add(crown);
    const beard = new THREE.Mesh(new THREE.TorusGeometry(0.195, 0.028, 6, 14, Math.PI), new THREE.MeshStandardMaterial({ color: 0x3a2a16, roughness: 0.9 }));
    beard.position.set(0, H(1.95), 0);
    beard.rotation.x = Math.PI / 2;
    HG.add(beard);
    const grill = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.022, 8, 14, Math.PI), new THREE.MeshBasicMaterial({ color: 0xd8a83c }));
    grill.position.set(0, H(2.045), 0.218);
    grill.rotation.z = Math.PI;
    HG.add(grill);
    // 兩片大綠披風(依速度揚起飄動,updatePoses 處理)
    const capeMat = new THREE.MeshStandardMaterial({ color: 0x3f8f5a, roughness: 0.8, side: THREE.DoubleSide });
    person.capes = [];
    for (const x of [-0.21, 0.21]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 1.8, -0.17);
      const cape = new THREE.Mesh(new THREE.BoxGeometry(0.34, 1.0, 0.03), capeMat);
      cape.position.y = -0.5;
      pivot.add(cape);
      pivot.rotation.x = 0.3;
      person.rig.add(pivot);
      person.capes.push(pivot);
    }
  }
  return person;
}

// 黃金迴旋:發射爪彈瞬間,馬身環繞金色長方形面板旋轉 1.4s(equestrian nf21 移植)
function makeGoldenSpin() {
  const group = new THREE.Group();
  const mats = [];
  for (let i = 0; i < 8; i += 1) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    mats.push(mat);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.34), mat);
    const a = (i / 8) * Math.PI * 2;
    panel.position.set(Math.cos(a) * 1.45, 1.5 + (i % 2) * 0.45, Math.sin(a) * 1.45);
    panel.rotation.y = -a + Math.PI / 2;
    panel.rotation.x = 0.18;
    group.add(panel);
  }
  return { group, mats };
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
// withHelm=false 給角色皮用(傑洛/喬尼戴自己的帽子,不戴全罩盔)
function knightUp(person, teamColor, plumeColor, withHelm = true) {
  const teamMat = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.6 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0xb9c0c8, metalness: 0.65, roughness: 0.35 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0xd9c9a8, roughness: 0.7 });
  const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x6d4a26, roughness: 0.7 });
  if (withHelm) {
    // 全罩盔(蓋住頭髮)+隊色羽飾——掛 headGroup:idle 轉頭時「盔連臉一起轉」(戴盔鐵則)
    const HG = person.headGroup;
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.29, 16, 12), steelMat);
    helm.position.y = 0; // 頭中心(2.12)
    HG.add(helm);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.12), new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.4 }));
    visor.position.set(0, 0, 0.24);
    HG.add(visor);
    const plume = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.34, 0.16), new THREE.MeshStandardMaterial({ color: plumeColor, roughness: 0.9 }));
    plume.position.set(0, 2.48 - 2.12, -0.05);
    plume.rotation.x = -0.3;
    HG.add(plume);
  }
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
    bow.rotation.y = -Math.PI / 2; // 弓背朝對手、弦朝自己(07-17 修:原本反了)
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
    this.characterId = CHARACTERS[settings.character] ? settings.character : "default";

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
    this.spinFx = []; // 黃金迴旋
    this.myTimeStop = 0; // THE WORLD(玩家發動:對手凍結)
    this.foeTimeStop = 0; // AI 迪亞哥發動:你被凍結
    this.foeCharacterId = null;
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
    this.keyLight = key;
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

    // 觀眾看台(兩側,退到圍欄外)——個別人偶(有 headGroup+雙臂),接 animateCrowdCheer 舉手人浪
    this.crowd = new THREE.Group();
    this.crowdFigures = [];
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
        // 相位=座號×0.9+對側偏移(決定性,不用 Math.random)→ 此起彼落人浪
        this.crowdFigures.push({ fig: p, phase: i * 0.9 + (side > 0 ? 0.45 : 0), rigY: p.rig.position.y });
      }
    }
    this.scene.add(this.crowd);

    // 我方:紅騎士(角色可選:傑洛/喬尼);對手:藍騎士(選角時自動變另一位)
    this._buildRiders();

    // 擊中閃光(被擊者身上亮一圈)
    this.hitFlash = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.42, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0, side: THREE.DoubleSide }),
    );
    this.scene.add(this.hitFlash);
    this.hitFlashT = 9;

    // ---------- 天氣氛圍(race-stage-kit ④:純視覺不影響比賽鐵則) ----------
    // 日夜循環+夜間極光+飄雪陣風;競技場小,極光環半徑 70-105 > 場地 25 即安全
    this.buildWeather();

    this.resetRiders();
  }

  // 建(或重建)兩位騎士——選角色時整組重蓋(選單階段呼叫,不在戰鬥中換)
  _buildRiders() {
    const brain = this.foe ? this.foe.brain : { retreatT: 0, switchT: 5, orbitDir: 1 };
    if (this.my) this.scene.remove(this.my.horse.group);
    if (this.foe) this.scene.remove(this.foe.horse.group);
    const coat = HORSE_COATS[this.coatId] || HORSE_COATS.brown;
    const pc = this.characterId === "default" ? null : this.characterId;
    const pool = ["gyro", "johnny", "diego"].filter((c) => c !== pc);
    const foeChar = pc ? pool[Math.floor(Math.random() * pool.length)] : null;
    this.foeCharacterId = foeChar;
    this.my = this.makeRider({
      coat: coat.coat, mane: coat.mane, caparison: 0xb03030,
      shirt: 0xb03030, pants: 0x5a2a2a, team: 0xb03030, plume: 0xf6d743,
      character: pc,
    });
    this.foe = this.makeRider({
      coat: 0x4a4a52, mane: 0x1c1c22, caparison: 0x2f5f9a,
      shirt: 0x2f5f9a, pants: 0x24304a, team: 0x2f5f9a, plume: 0xf5f0e0,
      character: foeChar,
    });
    this.foe.brain = brain;
    // idle 生動:兩騎不同 phase/period 錯開,不整齊劃一(決定性,不用 Math.random)
    this.my.idlePhase = 0;
    this.my.idlePeriod = 5.6;
    this.foe.idlePhase = 2.7;
    this.foe.idlePeriod = 6.4;
    this.setRiderWeapon(this.my, this.weaponId);
    this.setRiderWeapon(this.foe, "lance");
  }

  setCharacter(charId) {
    if (!CHARACTERS[charId] || charId === this.characterId) return;
    this.characterId = charId;
    this._buildRiders();
    this.resetRiders();
  }

  makeRider({ coat, mane, caparison, shirt, pants, team, plume, character = null }) {
    const horse = makeHorse({ coat, mane, caparison });
    this.scene.add(horse.group);
    const person = character
      ? makeCharacterPerson(character, 0.95)
      : makePerson({ shirt, pants, scale: 0.95 });
    person.leftLeg.pivot.rotation.x = -1.25;
    person.leftLeg.pivot.rotation.z = 0.5;
    person.leftLeg.joint.rotation.x = 1.5;
    person.rightLeg.pivot.rotation.x = -1.25;
    person.rightLeg.pivot.rotation.z = -0.5;
    person.rightLeg.joint.rotation.x = 1.5;
    const gear = knightUp(person, team, plume, !character); // 角色皮戴自己的帽,不戴全罩盔
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
      sprintT: 0, techCd: 0, charCd: 0, leap: null, dash: null, airY: 0,
      blocking: false, blockT: 9,
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
      rider.sprintT = 0;
      rider.techCd = 0;
      rider.charCd = 0;
      rider.leap = null;
      rider.dash = null;
      rider.airY = 0;
      rider.blocking = false;
      rider.blockT = 9;
      rider.person.group.rotation.z = 0;
      rider.person.group.position.set(0, 0.82, 0.12);
    }
    this.roundNo = 0;
    this.lastHit = null;
    this.endT = -1;
    this.hitCamT = 9;
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles = [];
    for (const fx of this.spinFx) fx.host.rig.remove(fx.group);
    this.spinFx = [];
    this.myTimeStop = 0;
    this.foeTimeStop = 0;
    this._setWorldGray(false);
    this.canvas.style.filter = "";
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
      this.foe.brain.blockHold = 0;
    }
    this.syncRiderTransforms();
    // 鏡頭硬切到玩家後方(lerp 穿場鐵則)
    const fwd = new THREE.Vector3(Math.sin(this.my.heading), 0, Math.cos(this.my.heading));
    this.camPos.copy(this.my.pos).addScaledVector(fwd, -8.5).setY(4.2);
    this.camLook.copy(this.my.pos).addScaledVector(fwd, 10).setY(1.6);
  }

  syncRiderTransforms() {
    for (const rider of [this.my, this.foe]) {
      rider.horse.group.position.set(rider.pos.x, rider.airY || 0, rider.pos.z);
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
    saveSettings({ difficulty: this.difficulty, modeId: this.modeId, horseCoat: this.coatId, weaponId, character: this.characterId });
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

  // 按下出手:開戰/突進技(衝刺中)/開始蓄力(短按放開=普攻,長按=大招)
  _shootPress() {
    if (this.overlay.visible) return;
    if (this.phase === "gate") {
      this.strike();
      return;
    }
    if (this.phase !== "battle" || this.my.koT >= 0 || this.endT >= 0) return;
    if (this.my.leap || this.my.dash || this.my.blocking) return;
    if (this.my.cd > 0 || this.my.stunT < this._stunDur()) return;
    // 衝刺一小段後按出手=突進技:遠=跳殺、近=飛殺
    if (this.my.sprintT >= SPRINT_ARM && this.my.techCd <= 0 && this.foe.koT < 0) {
      const dist = this.my.pos.distanceTo(this.foe.pos);
      if (dist >= DASH_RANGE[0] && dist < DASH_RANGE[1]) {
        this._startDash(this.my);
        return;
      }
      if (dist >= LEAP_RANGE[0] && dist <= LEAP_RANGE[1]) {
        this._startLeap(this.my);
        return;
      }
    }
    if (this.my.chargeT < 0) this.my.chargeT = 0;
  }

  // ---------- 突進技:跳殺(躍撲落地斬)/飛殺(爆發突進斬) ----------
  // 快速鍵直發(07-16 使用者點名:E=跳殺、R=飛殺,不用先衝刺);距離不對給提示
  _tryTech(kind) {
    if (this.overlay.visible || this.phase !== "battle" || this.endT >= 0) return;
    const r = this.my;
    if (r.koT >= 0 || r.leap || r.dash || r.blocking || r.stunT < this._stunDur()) return;
    if (this.foe.koT >= 0) return;
    if (r.techCd > 0) {
      this.message = `突進技冷卻中…(${r.techCd.toFixed(1)}s)`;
      this.pushHud();
      return;
    }
    const dist = r.pos.distanceTo(this.foe.pos);
    if (kind === "leap") {
      if (dist < DASH_RANGE[0]) {
        this.message = "太近了——跳殺要拉開一點距離!";
        this.pushHud();
        return;
      }
      if (dist > LEAP_RANGE[1]) {
        this.message = "太遠了——跳殺搆不到,先衝近一點!";
        this.pushHud();
        return;
      }
      r.chargeT = -1;
      this._startLeap(r);
    } else {
      if (dist > DASH_RANGE[1] + 4) {
        this.message = "太遠了——飛殺要再靠近一點!";
        this.pushHud();
        return;
      }
      r.chargeT = -1;
      this._startDash(r);
    }
  }

  _startLeap(rider) {
    const target = this.foe;
    const dist = rider.pos.distanceTo(target.pos);
    const dur = 0.5 + dist * 0.015;
    // 預判對手移動,落點停在對手身前一步
    const to = target.pos.clone().addScaledVector(
      new THREE.Vector3(Math.sin(target.heading), 0, Math.cos(target.heading)),
      target.speed * dur * 0.7,
    );
    to.x = clamp(to.x, -ARENA_HALF, ARENA_HALF);
    to.z = clamp(to.z, -ARENA_HALF, ARENA_HALF);
    const dir = to.clone().sub(rider.pos).normalize();
    to.addScaledVector(dir, -1.5);
    rider.leap = { t: 0, dur, from: rider.pos.clone(), to, h: 2.4 };
    rider.heading = Math.atan2(to.x - rider.pos.x, to.z - rider.pos.z);
    rider.chargeT = -1;
    rider.sprintT = 0;
    rider.techCd = TECH_CD;
    this.roundNo += 1;
    this.emitEvent("leap", { who: "me" });
    this.message = "跳殺——飛身躍向對手!";
    this.pushHud();
  }

  _landLeap(rider) {
    rider.leap = null;
    rider.airY = 0;
    rider.speed *= 0.5;
    rider.strikeT = 0; // 落地斬演出
    const w = WEAPONS[rider.weaponId];
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const target = this.foe;
    const dist = rider.pos.distanceTo(target.pos);
    rider.heading = Math.atan2(target.pos.x - rider.pos.x, target.pos.z - rider.pos.z);
    rider.cd = w.cd * 1.4;
    const reach = Math.max(w.reach, 2.0) + BODY_REACH + 1.0;
    if (dist <= reach && target.koT < 0) {
      const dmg = w.dmg * 1.6 * (1 + preset.assist * 0.6);
      this._pendingStrikes.push({
        target,
        dmg: Math.round(dmg),
        opts: { who: "me", weapon: { label: `${w.label}跳殺`, short: "跳殺" }, stun: 0, attacker: rider, kind: "melee" },
        t: 0.12,
      });
    } else {
      this.emitEvent("miss", { who: "me" });
      this.message = "跳殺落空——再抓準一點起跳!";
    }
    this.pushHud();
  }

  _startDash(rider) {
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const target = this.foe;
    rider.heading = Math.atan2(target.pos.x - rider.pos.x, target.pos.z - rider.pos.z);
    rider.dash = { t: 0, dur: 0.55, speed: (preset.maxFwd + preset.boost) * 1.8 };
    rider.chargeT = -1;
    rider.sprintT = 0;
    rider.techCd = TECH_CD;
    this.roundNo += 1;
    this.emitEvent("dash", { who: "me" });
    this.message = "飛殺——閃電突進!";
    this.pushHud();
  }

  _landDash(rider, dist) {
    rider.dash = null;
    rider.strikeT = 0;
    const w = WEAPONS[rider.weaponId];
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const target = this.foe;
    rider.cd = w.cd * 1.3;
    if (dist <= 2.4 && target.koT < 0) {
      rider.speed *= 0.35;
      const dmg = w.dmg * 1.5 * (1 + preset.assist * 0.6);
      this._pendingStrikes.push({
        target,
        dmg: Math.round(dmg),
        opts: { who: "me", weapon: { label: `${w.label}飛殺`, short: "飛殺" }, stun: 0, attacker: rider, kind: "melee" },
        t: 0.1,
      });
    } else {
      this.emitEvent("miss", { who: "me" });
      this.message = "飛殺撲空——抓準距離再突進!";
    }
    this.pushHud();
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
  applyPresentation({ difficulty, modeId, horseCoat, weaponId, character }) {
    if (difficulty && DIFFICULTY_PRESETS[difficulty]) this.difficulty = difficulty;
    if (modeId && GAME_MODES[modeId]) {
      this.modeId = modeId;
      this.mode = getModeConfig(modeId);
    }
    if (horseCoat && HORSE_COATS[horseCoat]) this.setHorseCoat(horseCoat);
    if (character && CHARACTERS[character]) this.setCharacter(character);
    if (weaponId && WEAPONS[weaponId]) {
      this.weaponId = weaponId;
      this.setRiderWeapon(this.my, weaponId);
    }
    saveSettings({ difficulty: this.difficulty, modeId: this.modeId, horseCoat: this.coatId, weaponId: this.weaponId, character: this.characterId });
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
        opts: { who: isPlayer ? "me" : "ai", weapon: w, stun: 0, attacker: rider, kind: "melee" },
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

  // 格擋判定:舉盾中且攻擊來源在正面 ±BLOCK_ARC 內;近戰且剛舉盾 ≤PARRY_WINDOW=完美盾反
  _blockCheck(target, src, kind) {
    if (!target.blocking || !src) return null;
    const ang = Math.abs(wrapAngle(Math.atan2(src.x - target.pos.x, src.z - target.pos.z) - target.heading));
    if (ang > BLOCK_ARC) return null;
    if (kind === "melee" && target.blockT <= PARRY_WINDOW) return "parry";
    return "block";
  }

  // THE WORLD 世界抽復古黃(07-18:時停=老照片泛黃,只有迪亞哥有顏色)——
  // CSS filter 會把施放者一起變灰,改成材質級抽色:全場材質轉灰階、只跳過 keepGroup(施放者)。
  _setWorldGray(on, keepGroup) {
    const lum = (hex) => { // 復古泛黃 sepia(07-18 使用者拍板:時停從黑白改成老照片黃)
      const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
      const v = r * 0.299 + g * 0.587 + b * 0.114;
      const tr = Math.min(255, Math.round(v * 1.25));
      const tg = Math.min(255, Math.round(v * 1.06));
      const tb = Math.round(v * 0.66);
      return (tr << 16) | (tg << 8) | tb;
    };
    if (on) {
      if (this._tsGray) return; // 已抽色(雙方連放保險)
      this._tsGray = { mats: [], inst: [], vtx: [], bg: null, fog: null };
      const seen = new Set();
      this.scene.traverse((o) => {
        let keep = false;
        for (let q = o; q; q = q.parent) if (q === keepGroup) { keep = true; break; }
        if (keep || !o.isMesh || !o.material) return;
        if (o.isInstancedMesh && o.instanceColor) { // 觀眾等 instanced 色也要抽
          this._tsGray.inst.push({ mesh: o, orig: o.instanceColor.array.slice() });
          const a = o.instanceColor.array;
          for (let i = 0; i < a.length; i += 3) {
            const v = a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114;
            a[i] = Math.min(1, v * 1.25); a[i + 1] = Math.min(1, v * 1.06); a[i + 2] = v * 0.66;
          }
          o.instanceColor.needsUpdate = true;
        }
        if (o.geometry?.attributes?.color) { // 地形帶/彩帶等 vertex colors 也要抽
          this._tsGray.vtx.push({ geo: o.geometry, orig: o.geometry.attributes.color.array.slice() });
          const c = o.geometry.attributes.color.array;
          const n = o.geometry.attributes.color.itemSize; // 3 或 4(RGBA 只動前三)
          for (let i = 0; i < c.length; i += n) {
            const v = c[i] * 0.299 + c[i + 1] * 0.587 + c[i + 2] * 0.114;
            c[i] = Math.min(1, v * 1.25); c[i + 1] = Math.min(1, v * 1.06); c[i + 2] = v * 0.66;
          }
          o.geometry.attributes.color.needsUpdate = true;
        }
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (seen.has(m)) continue;
          seen.add(m);
          const rec = { m, color: m.color ? m.color.getHex() : null, emissive: m.emissive ? m.emissive.getHex() : null };
          this._tsGray.mats.push(rec);
          if (m.color) m.color.setHex(lum(rec.color));
          if (m.emissive) m.emissive.setHex(lum(rec.emissive));
        }
      });
      if (this.scene.background && this.scene.background.isColor) {
        this._tsGray.bg = this.scene.background.getHex();
        this.scene.background.setHex(lum(this._tsGray.bg));
      }
      if (this.scene.fog) {
        this._tsGray.fog = this.scene.fog.color.getHex();
        this.scene.fog.color.setHex(lum(this._tsGray.fog));
      }
    } else {
      if (!this._tsGray) return;
      for (const rec of this._tsGray.mats) {
        if (rec.color !== null) rec.m.color.setHex(rec.color);
        if (rec.emissive !== null) rec.m.emissive.setHex(rec.emissive);
      }
      for (const it of this._tsGray.inst) {
        it.mesh.instanceColor.array.set(it.orig);
        it.mesh.instanceColor.needsUpdate = true;
      }
      for (const it of this._tsGray.vtx) {
        it.geo.attributes.color.array.set(it.orig);
        it.geo.attributes.color.needsUpdate = true;
      }
      if (this._tsGray.bg !== null && this.scene.background?.isColor) this.scene.background.setHex(this._tsGray.bg);
      if (this._tsGray.fog !== null && this.scene.fog) this.scene.fog.color.setHex(this._tsGray.fog);
      this._tsGray = null;
    }
  }

  applyHit(target, dmg, { who, weapon, stun, attacker, from, kind }) {
    if (this.phase !== "battle" || target.koT >= 0 || this.endT >= 0) return;
    const src = from || (attacker ? attacker.pos : null);
    const block = this._blockCheck(target, src, kind);
    if (block) {
      // 盾擊閃光(白)
      this.hitFlash.position.copy(target.pos).setY(1.9);
      this.hitFlash.material.color.setHex(0xffffff);
      this.hitFlashT = 0;
      if (block === "parry") {
        // 完美盾反:無傷+攻擊者被彈開硬直
        this.hitCamT = 0;
        if (attacker) {
          attacker.stunT = 0;
          attacker.cd = Math.max(attacker.cd, 1.2);
          attacker.speed *= -0.25;
          attacker.chargeT = -1;
        }
        this.emitEvent("parry", { who: target === this.my ? "me" : "ai" });
        this.message = target === this.my ? "完美盾反!對手被彈開!" : "被對手盾反彈開——小心他的節奏!";
        this.pushHud();
        return;
      }
      // 一般格擋:箭/鋼球=無傷;近戰/大招波動=傷害×0.3(輕傷不後仰、不斷蓄力)
      const reduced = kind === "proj" ? 0 : Math.round(dmg * 0.3);
      this.emitEvent("block", { who: target === this.my ? "me" : "ai" });
      if (reduced <= 0) {
        this.message = target === this.my ? "舉盾格擋——擋下來了!" : "被對手舉盾擋下——繞到側面打!";
        this.pushHud();
        return;
      }
      target.hp = Math.max(0, target.hp - reduced);
      this.lastHit = { who, dmg: reduced, weapon: weapon.short };
      this.emitEvent("hit", { who, dmg: reduced, weapon: weapon.label, stun: false, myHp: this.my.hp, aiHp: this.foe.hp, round: this.roundNo });
      this.message = target === this.my ? `舉盾擋下大半——只受 -${reduced}` : `對手舉盾擋下大半——只造成 -${reduced}`;
      if (target.hp <= 0) {
        target.koT = 0;
        this.endT = 0;
        this.emitEvent("ko", { winner: who === "me" ? "me" : "ai" });
      }
      this.pushHud();
      return;
    }
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

  buildWeather() {
    // 極光三簾(加法混色:底亮綠→頂近黑=自然淡出;頂點 alpha 這版 three 不生效——race-stage-kit 兩雷)
    const AUR = [
      { r: 85, y: 42, h: 26, a0: -Math.PI, a1: Math.PI, phase: 0, speed: 0.5 },
      { r: 105, y: 56, h: 32, a0: -Math.PI * 0.9, a1: Math.PI * 0.35, phase: 2.1, speed: 0.38 },
      { r: 70, y: 34, h: 20, a0: -Math.PI * 0.1, a1: Math.PI * 0.95, phase: 4.2, speed: 0.66 },
    ];
    const SEGS = 64;
    this.aurora = { group: new THREE.Group(), curtains: [] };
    for (const cfg of AUR) {
      const pos = new Float32Array((SEGS + 1) * 2 * 3);
      const col = new Float32Array((SEGS + 1) * 2 * 3);
      const idx = [];
      for (let i = 0; i <= SEGS; i += 1) {
        const a = cfg.a0 + (cfg.a1 - cfg.a0) * (i / SEGS);
        const x = Math.cos(a) * cfg.r;
        const z = Math.sin(a) * cfg.r;
        pos[(i * 2) * 3] = x; pos[(i * 2) * 3 + 1] = cfg.y; pos[(i * 2) * 3 + 2] = z;
        col[(i * 2) * 3] = 0.15; col[(i * 2) * 3 + 1] = 0.85; col[(i * 2) * 3 + 2] = 0.45;
        pos[(i * 2 + 1) * 3] = x; pos[(i * 2 + 1) * 3 + 1] = cfg.y + cfg.h; pos[(i * 2 + 1) * 3 + 2] = z;
        col[(i * 2 + 1) * 3] = 0.09; col[(i * 2 + 1) * 3 + 1] = 0.02; col[(i * 2 + 1) * 3 + 2] = 0.16;
        if (i < SEGS) { const b = i * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      this.aurora.group.add(mesh);
      this.aurora.curtains.push({ mesh, base: pos.slice(), phase: cfg.phase, speed: cfg.speed });
    }
    this.aurora.group.visible = false;
    this.scene.add(this.aurora.group);
    // 飄雪粒子(場地 ±30 盒,wrap)
    const N = 420;
    const spos = new Float32Array(N * 3);
    for (let i = 0; i < N; i += 1) {
      spos[i * 3] = (Math.random() - 0.5) * 60;
      spos[i * 3 + 1] = Math.random() * 20;
      spos[i * 3 + 2] = (Math.random() - 0.5) * 60;
    }
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute("position", new THREE.BufferAttribute(spos, 3));
    this.snowFx = {
      pts: new THREE.Points(sgeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.22, transparent: true, opacity: 0.7, depthWrite: false, fog: false })),
      speeds: Float32Array.from({ length: N }, () => 3 + Math.random() * 3),
    };
    this.scene.add(this.snowFx.pts);
    this.blizzardWarned = false;
  }

  dayHours() { // 遊戲一天=50 秒,選單/戰鬥都在流動
    return (6 + this.time * (24 / 50)) % 24;
  }

  updateWeather(delta) {
    if (this._tsGray) return; // THE WORLD 時停中:天空/極光凍結(日夜 lerp 會蓋掉世界抽色)
    // 日夜天色(race-stage-kit ③;夜=深藍 0x0a2050)
    const KEYS = [
      [0, 0x0a2050, 0.35], [5, 0x0a2050, 0.35], [6.5, 0xf0955f, 1.1],
      [9, 0x8fc4e8, 1.9], [16, 0x8fc4e8, 1.9], [18.5, 0xf0854f, 1.0],
      [20, 0x0a2050, 0.35], [24, 0x0a2050, 0.35],
    ];
    const h = this.dayHours();
    let a = KEYS[0], b = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i += 1) {
      if (h >= KEYS[i][0] && h <= KEYS[i + 1][0]) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    }
    const t = (h - a[0]) / (b[0] - a[0] || 1);
    const ca = new THREE.Color(a[1]).lerp(new THREE.Color(b[1]), t);
    this.scene.background = ca;
    if (this.keyLight) this.keyLight.intensity = a[2] + (b[2] - a[2]) * t;
    // 陣風飄雪(純視覺):~52 秒一波白茫
    const gust = Math.max(0, Math.min(1, (Math.sin(this.time * 0.12) - 0.55) / 0.45));
    if (this.scene.fog) {
      this.scene.fog.color.copy(ca);
      this.scene.fog.near = 70 - 44 * gust;
      this.scene.fog.far = 180 - 100 * gust;
    }
    if (gust > 0.5 && !this.blizzardWarned) {
      this.blizzardWarned = true;
      this.message = "暴風雪來了——白茫一片,看緊對手!";
      this.pushHud();
    }
    if (gust < 0.2) this.blizzardWarned = false;
    if (this.snowFx) {
      const attr = this.snowFx.pts.geometry.getAttribute("position");
      const windX = (1.2 + 7 * gust) * delta;
      for (let i = 0; i < attr.count; i += 1) {
        attr.array[i * 3 + 1] -= this.snowFx.speeds[i] * (1 + gust * 1.6) * delta;
        attr.array[i * 3] += windX * (0.6 + (i % 5) * 0.2);
        if (attr.array[i * 3 + 1] < 0) attr.array[i * 3 + 1] = 20;
        if (attr.array[i * 3] > 30) attr.array[i * 3] = -30;
        if (attr.array[i * 3 + 2] > 30) attr.array[i * 3 + 2] = -30;
        if (attr.array[i * 3 + 2] < -30) attr.array[i * 3 + 2] = 30;
      }
      attr.needsUpdate = true;
      this.snowFx.pts.material.opacity = 0.55 + 0.45 * gust;
    }
    // 夜間極光(19.5 淡入/5.5 淡出+頂點波動=流動)
    if (this.aurora) {
      let nf = 0;
      if (h >= 20.5 || h <= 4.5) nf = 1;
      else if (h > 19.5 && h < 20.5) nf = h - 19.5;
      else if (h > 4.5 && h < 5.5) nf = 5.5 - h;
      this.aurora.group.visible = nf > 0.02;
      if (this.aurora.group.visible) {
        for (const c of this.aurora.curtains) {
          c.mesh.material.opacity = nf * 0.65;
          const attr = c.mesh.geometry.getAttribute("position");
          for (let i = 0; i < attr.count / 2; i += 1) {
            const sway = Math.sin(i * 0.32 + this.time * c.speed + c.phase) * 4;
            const swayTop = Math.sin(i * 0.32 + this.time * c.speed * 1.35 + c.phase + 0.9) * 7;
            attr.array[(i * 2) * 3] = c.base[(i * 2) * 3] + sway;
            attr.array[(i * 2 + 1) * 3] = c.base[(i * 2 + 1) * 3] + swayTop;
          }
          attr.needsUpdate = true;
        }
      }
    }
    // 黃金迴旋動畫
    for (const fx of this.spinFx) {
      fx.t += delta;
      fx.group.rotation.y += 7 * delta;
      const fade = fx.t > 1.0 ? Math.max(0, 1 - (fx.t - 1.0) / 0.4) : 1;
      for (const m of fx.mats) m.opacity = 0.9 * fade;
    }
    this.spinFx = this.spinFx.filter((fx) => {
      if (fx.t >= 1.4) { fx.host.rig.remove(fx.group); return false; }
      return true;
    });
  }

  // ---------- 角色技能(G 鍵/技能鈕;race-stage-kit ⑤) ----------
  _tryCharSkill() {
    if (this.phase !== "battle" || this.overlay.visible) return;
    if (this.foeTimeStop > 0) return; // 你的時間被停了
    const ch = this.characterId === "default" ? null : this.characterId;
    if (!ch) { this.message = "紅騎士沒有替身技能——選傑洛/喬尼/迪亞哥!"; this.pushHud(); return; }
    if (ch === "gyro") { this.message = "傑洛的鋼球=第 8 號武器「雙綠鋼球」,直接切著丟!"; this.pushHud(); return; }
    if (this.my.charCd > 0) { this.message = `${CHARACTER_SKILLS[ch].label}回轉中……還要 ${this.my.charCd.toFixed(1)} 秒`; this.pushHud(); return; }
    if (ch === "johnny") {
      this.my.charCd = CHARACTER_SKILLS.johnny.cd;
      this._fireNail(this.my, this.foe);
      this._spawnGoldenSpin(this.my);
      this.message = "喬尼射出爪彈——黃金迴旋!";
    } else if (ch === "diego") {
      this.my.charCd = CHARACTER_SKILLS.diego.cd;
      this.myTimeStop = 4;
      this._setWorldGray(true, this.my.horse.group); // 世界抽色,只有我(迪亞哥)有顏色
      this.message = "迪亞哥:THE WORLD!時間停止 4 秒——只有你能動!";
    }
    this.pushHud();
  }

  _spawnGoldenSpin(rider) {
    const fx = makeGoldenSpin();
    rider.horse.rig.add(fx.group);
    this.spinFx.push({ group: fx.group, mats: fx.mats, t: 0, host: rider.horse });
  }

  _fireNail(shooter, target) {
    const from = shooter.pos.clone().setY(2.0);
    const targetPoint = target.pos.clone().setY(1.7);
    const dir = targetPoint.clone().sub(from).normalize();
    const vel = dir.multiplyScalar(30);
    const mesh = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.07, 0.3, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x2f7fe0, roughness: 0.3, metalness: 0.4, emissive: 0x1a4fa0, emissiveIntensity: 0.8 }),
    );
    core.rotation.x = Math.PI / 2;
    mesh.add(core);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 6, 14), new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.9 }));
    mesh.add(ring);
    mesh.position.copy(from);
    mesh.lookAt(from.clone().add(vel));
    this.scene.add(mesh);
    this.projectiles.push({
      mesh, vel, t: 0, dmg: 14, stun: 0, target,
      who: shooter === this.my ? "me" : "ai",
      weapon: { label: "爪彈", short: "爪彈", projSpeed: 30, maxRange: 48 },
    });
  }

  update(delta) {
    this.time += delta;
    const paused = this.overlay.visible;
    this.updateWeather(delta); // 天氣=純視覺,選單也流動
    // 觀眾歡呼人浪(舉手+左右看,相位錯開;THE WORLD 時停中觀眾也凍結)
    if (!this._tsGray) animateCrowdCheer(this.crowdFigures, this.time);

    // 命中瞬間慢動作(0.4s,打擊感)
    this._slowMo = !paused && this.hitCamT < 0.4 ? 0.42 : 1;
    const sdt = delta * this._slowMo;

    if (!paused && this.phase === "battle") {
      // THE WORLD 計時與復原
      if (this.myTimeStop > 0) {
        this.myTimeStop -= delta;
        if (this.myTimeStop <= 0 && this.foeTimeStop <= 0) { this._setWorldGray(false); this.message = "時間再次流動。"; this.pushHud(); }
      }
      if (this.foeTimeStop > 0) {
        this.foeTimeStop -= delta;
        if (this.foeTimeStop <= 0 && this.myTimeStop <= 0) { this._setWorldGray(false); this.message = "時間再次流動——反擊!"; this.pushHud(); }
      }
      if (this.foeTimeStop <= 0) this.updatePlayerMovement(sdt); // 被時停=你動不了
      if (this.myTimeStop <= 0) this.updateAi(sdt); // 你時停=對手凍結
      if (this.myTimeStop <= 0 && this.foeTimeStop <= 0) this.updateProjectiles(sdt); // 時停中飛行物懸停
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
      rider.techCd = Math.max(0, rider.techCd - sdt);
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
    // 跳殺進行中:拋物線躍撲(暫時鎖控制)
    if (rider.leap) {
      rider.leap.t += dt;
      const k = clamp(rider.leap.t / rider.leap.dur, 0, 1);
      rider.pos.lerpVectors(rider.leap.from, rider.leap.to, k);
      rider.airY = rider.leap.h * 4 * k * (1 - k);
      rider.gallopT += dt * 1.4;
      if (k >= 1) this._landLeap(rider);
      return;
    }
    // 飛殺進行中:比衝刺更快的爆發直衝,碰到就斬
    if (rider.dash) {
      rider.dash.t += dt;
      rider.speed = rider.dash.speed;
      this.movePos(rider, dt);
      rider.gallopT += dt * (rider.speed / 8);
      const d = rider.pos.distanceTo(this.foe.pos);
      if (d <= 2.4 || rider.dash.t >= rider.dash.dur) this._landDash(rider, d);
      return;
    }
    const stunned = rider.stunT < this._stunDur();
    // 舉盾格擋(按住 K/C/舉盾鈕):慢速移動、不能出招;剛舉盾的瞬間=盾反窗
    const wantBlock = this.input.isDown("action") && !stunned && rider.chargeT < 0;
    if (wantBlock && !rider.blocking) rider.blockT = 0;
    else if (rider.blocking && wantBlock) rider.blockT += dt;
    rider.blocking = wantBlock;
    if (!rider.blocking) rider.blockT = 9;
    // 衝刺累計(突進技的啟動條件)
    const sprinting = this.input.isDown("up") && this.input.isDown("sprint") && !stunned;
    rider.sprintT = sprinting && Math.abs(rider.speed) > preset.maxFwd * 0.8 ? rider.sprintT + dt : 0;
    let target = 0;
    if (!stunned) {
      if (this.input.isDown("up")) target = preset.maxFwd + (this.input.isDown("sprint") ? preset.boost : 0);
      else if (this.input.isDown("down")) target = rider.speed > 0.6 ? 0 : -MAX_BACK;
      if (rider.chargeT >= 0) target *= 0.5; // 蓄力中放慢(大招有重量感)
      if (rider.blocking) target *= 0.35; // 舉盾中龜速推進
      const turn = (this.input.isDown("left") ? 1 : 0) - (this.input.isDown("right") ? 1 : 0);
      rider.heading += turn * preset.turnRate * dt;
      // 自動面向敵人(07-16 三修:按住前進=完全讓位,不然走不掉會被拉回去):
      // 只有「站定/後退/沒按方向」的纏鬥時刻才鎖定對手;A/D、衝刺、W 前進都不干預
      if (turn === 0 && !this.input.isDown("sprint") && !this.input.isDown("up") && this.foe.koT < 0) {
        const dxF = this.foe.pos.x - rider.pos.x;
        const dzF = this.foe.pos.z - rider.pos.z;
        const distF = Math.hypot(dxF, dzF);
        if (distF <= AUTO_FACE_RANGE) {
          const diff = wrapAngle(Math.atan2(dxF, dzF) - rider.heading);
          const maxTurn = preset.turnRate * 1.15 * dt;
          rider.heading += clamp(diff, -maxTurn, maxTurn);
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

  // 兩馬不重疊(輕推開,防穿模;跳殺空中不推)
  resolveBodyPush() {
    if (this.my.leap) return;
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
    // AI 角色技能(對手隨機騎另外兩位;冷卻長,溫柔版)
    const chF = this.foeCharacterId;
    if (chF && CHARACTER_SKILLS[chF] && this.phase === "battle" && this.foe.koT < 0 && this.my.koT < 0 && this.myTimeStop <= 0 && this.foeTimeStop <= 0) {
      this.foe.charCd = Math.max(0, (this.foe.charCd || 0) - dt);
      const dCh = this.foe.pos.distanceTo(this.my.pos);
      if (this.foe.charCd <= 0) {
        if (chF === "johnny" && dCh > 7 && dCh < 24) {
          this.foe.charCd = 12;
          this._fireNail(this.foe, this.my);
          this._spawnGoldenSpin(this.foe);
          this.message = "對面的喬尼射出爪彈——小心!";
          this.pushHud();
        } else if (chF === "diego" && dCh < 9) {
          this.foe.charCd = 20;
          this.foeTimeStop = 2.5;
          this._setWorldGray(true, this.foe.horse.group); // 世界抽色,只有對面迪亞哥有顏色
          this.message = "對面的迪亞哥:THE WORLD!你被時停了!";
          this.pushHud();
        }
      }
    }
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

    // 舉盾腦:玩家蓄大招/放突進技或近身纏鬥時,依 aiSkill 機率舉盾一小段
    if (rider.blocking) {
      brain.blockHold -= dt;
      rider.blockT += dt;
      if (brain.blockHold <= 0 || stunned) {
        rider.blocking = false;
        rider.blockT = 9;
      }
    } else if (!stunned && rider.chargeT < 0) {
      const threat = (this.my.chargeT >= CHARGE_MIN * 0.7 && dist < 16) || this.my.dash || this.my.leap;
      const skirmish = dist < 5 && rider.cd > 0.35;
      if ((threat && Math.random() < preset.aiSkill * dt * 7) || (skirmish && Math.random() < preset.aiSkill * dt * 2.5)) {
        rider.blocking = true;
        rider.blockT = 0;
        brain.blockHold = 0.6 + Math.random() * 0.8;
      }
    }
    if (rider.blocking) desiredSpeed *= 0.35;
    if (rider.chargeT >= 0) desiredSpeed *= 0.25; // AI 蓄力時明顯減速=玩家的閃避/打斷窗

    // 喘息腦(入門以下,07-16 使用者回饋 AI 太黏):每 4~8 秒停下喘 1.4 秒
    // =孩子的逃跑窗/反打窗;職業與標準沒有喘息
    if (preset.aiSkill < 0.6) {
      brain.breatherT = (brain.breatherT ?? 4) - dt;
      if (brain.breatherT <= 0) {
        brain.restT = 1.4;
        brain.breatherT = 4 + Math.random() * 4;
      }
      if (brain.restT > 0) {
        brain.restT -= dt;
        desiredSpeed *= 0.15;
      }
    }

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
    if (rider.blocking) return; // 舉盾中不出招
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
          this.applyHit(p.target, p.dmg, {
            who: p.who, weapon: p.weapon, stun: p.stun,
            from: p.mesh.position, kind: p.isWave ? "wave" : "proj",
          });
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
    if (this.input.consumePress("charskill")) this._tryCharSkill(); // G=角色技能
    if (this.input.consumePress("leap")) this._tryTech("leap"); // E=跳殺
    if (this.input.consumePress("dashkill")) this._tryTech("dash"); // R=飛殺
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
      let armY = 0; // 持刀臂水平掃角(360° 橫掃用)
      let rigY = 0; // 上身水平旋轉(微跟用)
      let strikeLean = 0; // 上身前壓(力道感)
      let weaponZ = 0.1;
      let weaponRotX = 0; // 武器貼臂角(橫掃時刀轉 90° 貼齊前臂,刀身才平躺水平面)
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
          // 360° 水平橫掃(07-16 修:不再整個上身自轉)——刀臂先下壓 90° 放平,
          // 再「只有持刀手臂」繞垂直軸在水平面掃一整圈,上身只微跟(重量感)
          armX = -1.5; // 手臂下壓 90°,大刀放平
          armJ = 0;
          weaponRotX = Math.PI / 2; // 刀貼臂(武器原與前臂垂直,放平時會立起——轉 90° 躺平)
          if (st < 0.12) { // 起手反擰
            armY = (st / 0.12) * 0.5;
            strikeLean = 0.08;
          } else if (st < 0.45) { // 手臂水平掃 360°
            armY = 0.5 - ((st - 0.12) / 0.33) * Math.PI * 2;
            strikeLean = 0.18;
          } else { // 收勢(0.5−2π 與 0.5 同向,直接從 0.5 收回 0)
            const k = (st - 0.45) / 0.15;
            armY = 0.5 * (1 - k);
          }
          rigY = armY * 0.15; // 上身微跟,不自轉
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
      // 傑洛披風:依馬速揚起+微飄
      if (person.capes) {
        const lift = 0.3 + clamp(Math.abs(rider.speed) / 12, 0, 1) * 0.9 + Math.sin(this.time * 6) * 0.08;
        for (const cape of person.capes) cape.rotation.x = lift;
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
      person.rightArm.pivot.rotation.order = "YXZ"; // 先水平掃角再抬臂角(橫掃要用)
      person.rightArm.pivot.rotation.x = armX;
      person.rightArm.pivot.rotation.y = armY;
      person.rightArm.joint.rotation.x = armJ;
      person.rig.rotation.y = rigY;
      if (model) {
        model.position.z = weaponZ;
        model.rotation.x = weaponRotX;
      }

      // 左臂盾:平時護胸;舉盾格擋=盾舉到身前正中(看得見「真的舉起來」)
      if (rider.blocking) {
        person.leftArm.pivot.rotation.x = -1.55;
        person.leftArm.pivot.rotation.z = -0.25;
        person.leftArm.joint.rotation.x = -0.35;
      } else {
        person.leftArm.pivot.rotation.x = -0.9; // 持盾護胸
        person.leftArm.pivot.rotation.z = 0.35;
        person.leftArm.joint.rotation.x = -0.18;
      }

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

      // —— idle 生動(idle-life.js):只在待機/準備/結算轉頭看一下+微笑 ——
      // 戰鬥中(衝鋒對撞)/落馬/時停一律不轉,平滑回正(lerp,不瞬跳);
      // 只動人的 headGroup,馬頭不套(那是人臉邏輯)。
      const idleOk = this.phase !== "battle" && rider.koT < 0 && !this._tsGray;
      if (idleOk) {
        animateIdleHead(person.headGroup, person.smile, this.time, {
          phase: rider.idlePhase || 0,
          period: rider.idlePeriod || 5.6,
        });
      } else if (person.headGroup) {
        person.headGroup.rotation.y += (0 - person.headGroup.rotation.y) * 0.15;
        if (person.smile) {
          person.smile.scale.x += (1 - person.smile.scale.x) * 0.15;
          person.smile.scale.y += (1 - person.smile.scale.y) * 0.15;
        }
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
