/**
 * CROWN — слой бренда поверх движка (код движка не меняем; это только UI-ярлыки и презентация).
 *
 * Лексикон: donation → Crown · standing/points → Reign · tier → rank (Squire…King) · сезонный топ-1 → The Crown.
 * Ранги здесь — каноническая лестница CROWN по очкам Reign (1 USDC = 1 Reign, курс фиксирован, ADR 0007).
 * Для ДИСПЛЕЯ на личных экранах ранг выводим по очкам, независимо от того, как стример назвал тиры в конфиге.
 */

export interface CrownRank {
  name: string;
  /** Порог в очках Reign, с которого начинается ранг. */
  min: number;
  /** Геральдический металл ранга (прогрессия камень → сталь → бронза → аметист → золото). */
  metal: string;
  /** Односимвольная монограмма для крест-бейджа. */
  sigil: string;
}

/** Лестница двора. Пороги — дефолты спеки (core-spec §6); The Crown 👑 — титул топ-1 сезона, не порог. */
export const RANKS: readonly CrownRank[] = [
  { name: "Squire", min: 0, metal: "#8a8577", sigil: "S" },
  { name: "Knight", min: 500, metal: "#bac1c8", sigil: "K" },
  { name: "Baron", min: 5_000, metal: "#b07a46", sigil: "B" },
  { name: "Duke", min: 50_000, metal: "#9a79c4", sigil: "D" },
  { name: "King", min: 200_000, metal: "#c9a24a", sigil: "K" },
] as const;

/** Текущий ранг по очкам Reign. */
export function rankOf(points: number): CrownRank {
  let current: CrownRank = RANKS[0]!;
  for (const r of RANKS) if (points >= r.min) current = r;
  return current;
}

export interface RankProgress {
  rank: CrownRank;
  next: CrownRank | null; // null → King (высший ранг)
  /** 0..1 — путь к следующему рангу; 1 на вершине. */
  progress: number;
  /** Сколько Reign до следующего ранга (0 на вершине). */
  toNext: number;
}

export function rankProgress(points: number): RankProgress {
  const rank = rankOf(points);
  const idx = RANKS.indexOf(rank);
  const next = idx < RANKS.length - 1 ? RANKS[idx + 1] : null;
  if (!next) return { rank, next: null, progress: 1, toNext: 0 };
  const span = next.min - rank.min;
  const done = points - rank.min;
  return { rank, next, progress: Math.max(0, Math.min(1, done / span)), toNext: Math.max(0, next.min - points) };
}

/** Относительное время по-английски (для показа; абсолютное — в title). */
export function timeAgoEn(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  return mo < 12 ? `${mo}mo ago` : `${Math.round(mo / 12)}y ago`;
}

/** Простая англ. плюрализация: n one/other. */
export function plur(n: number, one: string, other = one + "s"): string {
  return `${n} ${Math.abs(n) === 1 ? one : other}`;
}
