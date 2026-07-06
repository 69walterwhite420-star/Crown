/**
 * The Reign engine — a SHARED pure module (ADR 0001). The rate is FIXED: 1 USDC = 1 point, with no curves,
 * multipliers or decay (a product decision, ADR 0007). Points are FRACTIONAL, 1:1 to USDC with cents (2.5 USDC →
 * 2.5 points) — exact, without rounding. The streamer configures only TIERS/THRESHOLDS (how many points are needed
 * for perks/participation in mini-games), not the value of a point. Deterministic and recomputable (CLAUDE.md §4.4):
 * the same ledger → the same number everywhere.
 */
import type { LedgerEvent, MicroUSDC, Points, Tier } from "./data/types";

/** Fixed accrual rate: 1 USDC = 1 point. */
export const POINTS_PER_USDC = 1;

/** micro-USDC per 1 point: 1e6 micro/USDC ÷ 1 point/USDC. Point precision = micro (6 digits), like money. */
const MICRO_PER_POINT = 1_000_000;

/**
 * Points for a crown: the amount in USDC EXACTLY, 1:1 (2.5 USDC → 2.5 points). Fractional — without rounding, so
 * splitting a crown is NEUTRAL (0.5+0.5 = exactly 1.0, like a single crown of 1.0): no inflation (it used to be
 * round-half-up: 0.5·2=2>1), no loss of small change (it used to be floor: 0.5→0). The rate is exactly 1 point/USDC.
 * The text-display threshold is separate (minDonationWithText). Number is exact up to 2^53 micro (~9e9 USDC); the
 * fold snaps to micro in computePoints.
 */
export function pointsForAmount(amountMicro: MicroUSDC): Points {
  if (amountMicro <= 0n) return 0;
  return Number(amountMicro) / MICRO_PER_POINT;
}

/**
 * Fold of a donor's ledger for a realm → current points (fractional). The operator does NOT edit Reign (no manual
 * deduction, CR-1): the only negative delta is the protocol DISPUTE_LOST (a lost false dispute); it and the
 * donation growth are clamped to ≥0. Punishing a violator is a BLOCK of the wallet/realm (which devalues the
 * Reign, without touching the honest number). Determinism §4.4: we sum in INTEGER micro-points (each delta is a
 * multiple of 1e-6 → *1e6 gives an integer), one division at the end — float drift (0.1+0.2) is excluded, everyone computes the same.
 */
export function computePoints(events: LedgerEvent[]): Points {
  let micro = 0;
  for (const e of events) micro += Math.round(e.pointsDelta * MICRO_PER_POINT);
  return Math.max(0, micro) / MICRO_PER_POINT;
}

/**
 * Points at a MOMENT in time (snapshot): the same fold, but only over events with `ts ≤ asOf`. Needed by mini-games
 * with disputes — the vote weight is fixed at the second the dispute is raised (ADR 0015, game spec §5), so it's
 * impossible to farm/buy Reign "for this dispute" after it starts. `asOf` — an ISO string; comparison by time.
 */
export function computePointsAsOf(events: LedgerEvent[], asOf: string): Points {
  const cut = Date.parse(asOf);
  return computePoints(events.filter((e) => Date.parse(e.ts) <= cut));
}

export interface TierResolution {
  tier?: Tier; // undefined → fewer points than the FIRST tier's threshold ("no tier")
  nextTier?: Tier; // the next milestone; for "no tier" it's the first tier
  progressToNext: number; // 0..1 (to nextTier; for "no tier" — to the first tier from 0)
}

/**
 * Current tier by points + progress to the next. Tiers/thresholds are the streamer's only lever.
 * A tier is earned from its threshold: if points are below the FIRST tier's threshold — there is no tier (tier: undefined),
 * nextTier points to the first. A special case is the first tier with threshold 0 (like the default "Newcomer"): it's
 * the floor, any donor gets it (the "below entry" branch is then unreachable). Both configurations are supported.
 */
export function resolveTier(points: Points, tiers: Tier[]): TierResolution {
  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);
  const first = sorted[0];
  if (!first) return { progressToNext: 0 }; // no tiers at all
  if (points < first.threshold) {
    // below entry: progress to the first tier from 0 (threshold > 0 here is guaranteed by the check above).
    return { nextTier: first, progressToNext: first.threshold > 0 ? clamp01(points / first.threshold) : 1 };
  }
  let current = first;
  for (const t of sorted) {
    if (points >= t.threshold) current = t;
  }
  const idx = sorted.indexOf(current);
  const nextTier = sorted[idx + 1];
  const progressToNext = nextTier
    ? clamp01((points - current.threshold) / (nextTier.threshold - current.threshold))
    : 1;
  return { tier: current, nextTier, progressToNext };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
