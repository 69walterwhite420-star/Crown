/**
 * CROWN — a brand layer over the engine (we don't change the engine code; this is only UI labels and presentation).
 *
 * Lexicon: donation → Crown · standing/points → Reign · tier → rank (Squire…King) · seasonal top-1 → The Crown.
 * The ranks here are the canonical CROWN ladder by Reign points (1 USDC = 1 Reign, the rate is fixed, ADR 0007).
 * For DISPLAY on personal screens we derive the rank from points, regardless of how the streamer named tiers in the config.
 */

export interface CrownRank {
  name: string;
  /** Threshold in Reign points at which the rank begins. */
  min: number;
  /** The rank's heraldic metal (progression stone → steel → bronze → amethyst → gold). */
  metal: string;
  /** Single-character monogram for the cross-badge. */
  sigil: string;
}

/** The realm's ladder. Thresholds — spec defaults (core-spec §6); The Crown 👑 — the season's top-1 title, not a threshold. */
export const RANKS: readonly CrownRank[] = [
  { name: "Squire", min: 0, metal: "#8a8577", sigil: "S" },
  { name: "Knight", min: 500, metal: "#bac1c8", sigil: "K" },
  { name: "Baron", min: 5_000, metal: "#b07a46", sigil: "B" },
  { name: "Duke", min: 50_000, metal: "#9a79c4", sigil: "D" },
  { name: "King", min: 200_000, metal: "#c9a24a", sigil: "K" },
] as const;

/** Current rank by Reign points. */
export function rankOf(points: number): CrownRank {
  let current: CrownRank = RANKS[0]!;
  for (const r of RANKS) if (points >= r.min) current = r;
  return current;
}

export interface RankProgress {
  rank: CrownRank;
  next: CrownRank | null; // null → King (highest rank)
  /** 0..1 — path to the next rank; 1 at the top. */
  progress: number;
  /** How much Reign remains to the next rank (0 at the top). */
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

/** Relative time in English (for display; the absolute time — in title). */
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

/** Simple English pluralization: n one/other. */
export function plur(n: number, one: string, other = one + "s"): string {
  return `${n} ${Math.abs(n) === 1 ? one : other}`;
}
