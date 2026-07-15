# 3D 騎士比武(jousting3d,德義武鬥館)

> 騎乘引擎的「對衝時機」變體(2026-07-15):中世紀錦標賽運動化——兩騎沿分隔柵對衝,
> 綠區時機出槍擊盾:正中盾心 2 分、擦中 1 分。**點到為止無 KO**(拳擊館同款原則):
> 被擊中只後仰晃一下,不落馬、不受傷。

## 玩法

- **對決**:五回合(職業七回合),總分高者勝。
- **搶七**:不限回合,先到 7 分獲勝。
- **練習場**:無限回合,對手不計分。

點畫面=衝鋒;按住 W/↑=全速(出槍時機更難抓,張力所在);對手進 26m 內時機條開始充,
**綠區瞬間點「出槍」**。判定=畫面:按下當下算好分數,交錯瞬間演擊中(盾牌閃光+後仰)。
七色戰馬+紅/藍隊色馬衣(caparison)+羽飾頭盔+鈍頭比武槍(coronel)。

## 開發

```bash
npm install && npm run dev
npm run build && node scripts/gen-voice.mjs
node scripts/verify-jousting.mjs <url> <outDir>   # 完美騎士/不出槍/搶七三線驗證
```

## 部署

`npx netlify deploy --prod --dir dist --no-build --site deyi-jousting3d`
