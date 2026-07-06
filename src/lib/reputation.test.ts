import { describe, expect, it } from "vitest";
import type { LedgerEvent, LedgerType, Tier } from "./data/types";
import {
  computePoints,
  computePointsAsOf,
  pointsForAmount,
  POINTS_PER_USDC,
  resolveTier,
} from "./reputation";

/**
 * Tests of the Reign engine — insurance for the invariants before the mini-games sit on top of it
 * (they will start writing new +/− events to the ledger: GAME / DISPUTE_*). We pin down:
 *  §4.4 determinism of the fractional fold (same ledger → same number; snapping to micro removes float drift);
 *  §4.5 "only grows" + the single floor — clamp to 0;
 *  the fixed rate 1 USDC = 1 point, fractional with cents (ADR 0007).
 */

const USDC = 1_000_000n; // 1 USDC in micro

// — fixtures —
function ev(type: LedgerType, pointsDelta: number, amount: bigint = 0n): LedgerEvent {
  return {
    id: `e-${type}-${pointsDelta}-${amount}`,
    donor: "Donor111",
    creator: "chan-1",
    type,
    amount,
    pointsDelta,
    configVersion: 1,
    ts: "2026-01-01T00:00:00.000Z",
  };
}

function tier(name: string, threshold: number): Tier {
  return { name, threshold, color: "#fff", badge: name.toLowerCase(), perks: [] };
}

describe("pointsForAmount — rate 1 USDC = 1 point (ADR 0007)", () => {
  it("rate is fixed at 1", () => {
    expect(POINTS_PER_USDC).toBe(1);
  });

  it("1 USDC → 1 point", () => {
    expect(pointsForAmount(USDC)).toBe(1);
  });

  it("0 and negative → 0 points", () => {
    expect(pointsForAmount(0n)).toBe(0);
    expect(pointsForAmount(-5n)).toBe(0);
  });

  it("fractional points 1:1 with cents (2.5 USDC → 2.5 points) — without rounding", () => {
    expect(pointsForAmount(2_500_000n)).toBe(2.5); // 2.5 USDC → 2.5
    expect(pointsForAmount(500_000n)).toBe(0.5); // 0.5 → 0.5 (not lost)
    expect(pointsForAmount(100_000n)).toBe(0.1); // 0.1 → 0.1
    expect(pointsForAmount(2_530_000n)).toBe(2.53); // 2.53 → 2.53
    expect(pointsForAmount(1_234_567n)).toBe(1.234567); // down to micro precision
  });

  it("splitting a crown is NEUTRAL (exact 1:1: sum of pieces = the whole)", () => {
    // No inflation (was round-half-up: 0.5·2=2>1), no loss (was floor: 0.5→0). Now exactly:
    expect(pointsForAmount(500_000n) + pointsForAmount(500_000n)).toBe(pointsForAmount(1_000_000n));
    expect(pointsForAmount(700_000n) + pointsForAmount(800_000n)).toBe(pointsForAmount(1_500_000n));
  });

  it("precision on large amounts (Number(micro)/1e6 exact up to ~9e9 USDC)", () => {
    const huge = 1_000_000_000n * USDC; // 1e9 USDC = 1e15 micro < 2^53
    expect(pointsForAmount(huge)).toBe(1_000_000_000);
    expect(pointsForAmount(huge)).toBe(pointsForAmount(huge)); // pure function
  });
});

describe("computePoints — ledger fold", () => {
  it("empty ledger → 0", () => {
    expect(computePoints([])).toBe(0);
  });

  it("sums the crown deltas", () => {
    expect(computePoints([ev("DONATION", 100, 100n * USDC), ev("DONATION", 50, 50n * USDC)])).toBe(
      150,
    );
  });

  it("DISPUTE_LOST is subtracted (§4.5 — the only protocol deduction; the operator does not edit)", () => {
    expect(computePoints([ev("DONATION", 100), ev("DISPUTE_LOST", -30)])).toBe(70);
  });

  it("clamp to 0: Reign does not go negative", () => {
    expect(computePoints([ev("DONATION", 10), ev("DISPUTE_LOST", -50)])).toBe(0);
  });

  it("independent of event order (commutative sum → determinism §4.4)", () => {
    const forward = [ev("DONATION", 100), ev("DISPUTE_LOST", -30), ev("DONATION", 5)];
    const shuffled = [forward[2]!, forward[0]!, forward[1]!];
    expect(computePoints(shuffled)).toBe(computePoints(forward));
  });

  it("fractional deltas sum EXACTLY (snapping to micro removes the 0.1+0.2 float drift)", () => {
    // Naive 0.1+0.2 in float = 0.30000000000000004; the fold in integer micro-points gives exactly 0.3.
    expect(computePoints([ev("DONATION", 0.1), ev("DONATION", 0.2)])).toBe(0.3);
    // 2.5 + 2.53 = 5.03 exactly
    expect(computePoints([ev("DONATION", 2.5), ev("DONATION", 2.53)])).toBe(5.03);
  });

  describe("groundwork for games — non-crown event types add up the same way", () => {
    it("GAME / DISPUTE_WON / DISPUTE_LOST contribute their deltas", () => {
      expect(
        computePoints([
          ev("DONATION", 100),
          ev("GAME", -40),
          ev("DISPUTE_WON", 20),
          ev("DISPUTE_LOST", -10),
        ]),
      ).toBe(70);
    });

    it("a loss in a game doesn't break the floor: clamp to 0", () => {
      expect(computePoints([ev("DONATION", 10), ev("GAME", -999)])).toBe(0);
    });
  });
});

describe("computePointsAsOf — weight snapshot at a moment (for a game dispute)", () => {
  // event with an explicit timestamp
  const at = (pointsDelta: number, ts: string): LedgerEvent => ({
    ...ev("DONATION", pointsDelta),
    ts,
  });
  const log = [
    at(100, "2026-01-01T00:00:00.000Z"),
    at(50, "2026-02-01T00:00:00.000Z"),
    at(30, "2026-03-01T00:00:00.000Z"),
  ];

  it("counts only events with ts ≤ asOf", () => {
    expect(computePointsAsOf(log, "2026-02-15T00:00:00.000Z")).toBe(150); // 100 + 50
  });

  it("boundary is inclusive (ts == asOf is counted)", () => {
    expect(computePointsAsOf(log, "2026-02-01T00:00:00.000Z")).toBe(150);
  });

  it("asOf before all events → 0 (can't farm 'for a dispute' retroactively)", () => {
    expect(computePointsAsOf(log, "2025-12-31T00:00:00.000Z")).toBe(0);
  });

  it("asOf in the future → same as full computePoints", () => {
    expect(computePointsAsOf(log, "2027-01-01T00:00:00.000Z")).toBe(computePoints(log));
  });

  it("clamp to 0 applies on the slice too (DISPUTE_LOST before the cutoff)", () => {
    const withLoss = [
      at(10, "2026-01-01T00:00:00.000Z"),
      { ...ev("DISPUTE_LOST", -50), ts: "2026-01-02T00:00:00.000Z" },
    ];
    expect(computePointsAsOf(withLoss, "2026-01-03T00:00:00.000Z")).toBe(0);
  });
});

describe("vote weight = points at the snapshot (CR-1: the operator does not edit Reign)", () => {
  const at = (type: LedgerType, pointsDelta: number, ts: string): LedgerEvent => ({
    ...ev(type, pointsDelta),
    ts,
  });

  it("no manual deduction by the operator — weight rests on earned crowns", () => {
    // After removing ADMIN_VOID the operator has no way to write a negative delta to the ledger at all:
    // vote weight = an honest fold of crowns; punishing a violator is a wallet block (outside the ledger).
    const log = [at("DONATION", 100, "2026-01-01T00:00:00.000Z")];
    expect(computePointsAsOf(log, "2026-01-03T00:00:00.000Z")).toBe(100);
  });

  it("DISPUTE_LOST (protocol deduction for a false dispute) is counted in the weight", () => {
    const log = [
      at("DONATION", 100, "2026-01-01T00:00:00.000Z"),
      at("DISPUTE_LOST", -50, "2026-01-02T00:00:00.000Z"),
    ];
    expect(computePointsAsOf(log, "2026-01-03T00:00:00.000Z")).toBe(50);
  });
});

describe("resolveTier — tiers/thresholds (the streamer's only lever)", () => {
  const tiers = [tier("Bronze", 100), tier("Silver", 500), tier("Gold", 1000)];

  it("no tiers at all → no tier, no progress", () => {
    expect(resolveTier(50, [])).toEqual({ progressToNext: 0 });
  });

  it("below the first tier's threshold → tier is NOT granted (it's earned), nextTier = first", () => {
    const r = resolveTier(50, tiers);
    expect(r.tier).toBeUndefined();
    expect(r.nextTier?.name).toBe("Bronze");
    expect(r.progressToNext).toBeCloseTo(0.5); // 50 / 100
  });

  it("exactly at the first tier's threshold → tier granted (boundary inclusive)", () => {
    const r = resolveTier(100, tiers);
    expect(r.tier?.name).toBe("Bronze");
    expect(r.nextTier?.name).toBe("Silver");
    expect(r.progressToNext).toBeCloseTo(0); // (100-100)/(500-100)
  });

  it("1 point below the threshold → still no tier (not rounded up)", () => {
    expect(resolveTier(99, tiers).tier).toBeUndefined();
  });

  it("midway between tiers → current tier + progress to the next", () => {
    const r = resolveTier(300, tiers);
    expect(r.tier?.name).toBe("Bronze");
    expect(r.progressToNext).toBeCloseTo((300 - 100) / (500 - 100)); // 0.5
  });

  it("on the top tier → no nextTier, progress = 1", () => {
    const r = resolveTier(1500, tiers);
    expect(r.tier?.name).toBe("Gold");
    expect(r.nextTier).toBeUndefined();
    expect(r.progressToNext).toBe(1);
  });

  it("input tier order doesn't matter (sorted internally)", () => {
    const reversed = [tier("Gold", 1000), tier("Bronze", 100), tier("Silver", 500)];
    expect(resolveTier(600, reversed).tier?.name).toBe("Silver");
  });
});
