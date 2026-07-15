# CLAUDE.md — jousting3d(3D 騎士比武=騎乘引擎對衝變體,德義武鬥館)

> 2026-07-15。GitHub 唯一真相;帳號 summer09201017-cloud。base=equestrian3d 馬體+直線對衝道。

## 引擎要點

- 直線對衝(無樣條):myZ/aiZ 相向推進;`strike()` 判定=畫面:
  `err=|gap-STRIKE_IDEAL|/closing`、`q=1-err/(window*2.2)`;≥0.85=正中2分、≥0.45=擦中1分。
- 無 KO 鐵則:hitReactT 後仰演出+盾閃 hitFlash,不落馬;AI 得分=aiSkill±0.28 隨機。
- knightUp():全罩盔+羽飾+胸甲+隊色盾(白十字)+鈍頭槍(垂直儀仗→couch 放平→出槍前刺)。
- 馬=長腿 v3+鬃毛三件套;caparison 隊色馬衣。
- reset 階段滑行 1.8s → 下一回合 beginPass(鏡頭硬切防穿場)。

## 部署與同步

Netlify 手動站 **deyi-jousting3d**(武鬥館=deyi- 前綴);同步=deyi-arena 武鬥館入口頁卡片
+奧運頁示範賽區+portfolio+gamefleet(德義武鬥館 分類)。
