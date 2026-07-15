// 播報詞庫(固定句,全部預烤 mp3)——★人聲鐵律:預烤 mp3,不用 Web Speech;短句斷流雷:句子完整收尾。
export function voiceKey(text) {
  const s = String(text).replace(/\s+/g, "");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export const PHRASES = [
  // 開賽/衝鋒
  "歡迎來到騎士錦標賽!點到為止,騎士精神!",
  "號角響起,衝鋒!盯住時機條!",
  // 我方命中/落空
  "正中盾心!漂亮的一槍!",
  "擦中盾牌,拿下一分!",
  "可惜,這槍落空了。",
  "太早出槍了,穩住再出!",
  // 對手
  "對手這槍正中,小心了!",
  "對手擦中,比分咬緊!",
  "對手落空,機會來了!",
  // 終場
  "紅騎士獲勝!全場歡呼!",
  "平分秋色,再戰一場!",
  "這場對手技高一籌,再來!",
];

export const SCRIPTURES = [];
