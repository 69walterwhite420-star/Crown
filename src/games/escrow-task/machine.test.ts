import { describe, expect, it } from "vitest";
import { GameBusError } from "../bus";
import {
  accept,
  cancel,
  castVote,
  claim,
  createTask,
  dueResolution,
  hide,
  isTextPublic,
  DISPUTE_LOSS_PENALTY,
  DISPUTE_WIN_BONUS,
  markDone,
  raiseDispute,
  reject,
  repEffects,
  report,
  REPORT_HIDE_THRESHOLD,
  tally,
  WINDOWS,
} from "./machine";
import type { EscrowTask, TaskVote } from "./types";

/**
 * Tests of the "task-for-a-crown" state machine — pure logic per spec §5/§6/§11: transitions, time windows,
 * vote counting by weight, and reputation effects (ADR 0015). Time is deterministic (nowMs).
 */

const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const AMOUNT = "5000000"; // 5 USDC → 5 points (pointsForAmount)
const STREAMER = "Streamer1";
const TD = T0 + WINDOWS.grace + 1; // "Done" time — right AFTER the donor's cancel grace (ESC-13)

function newTask(executionMs?: number): EscrowTask {
  return createTask(
    { id: "t1", channelId: "ch-1", donor: "Donor1", amount: AMOUNT, text: "do X", executionMs },
    T0,
  );
}
const vote = (voter: string, choice: TaskVote["choice"], weight: number): TaskVote => ({
  voter,
  choice,
  weight,
  at: "2026-01-01T00:00:00.000Z",
});
// The machine throws GameBusError with the code in .code (.message is human text) → we check the code specifically.
function throwsCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof GameBusError ? e.code : `NOT_BUS_ERROR:${String(e)}`;
  }
  return "NO_THROW";
}

describe("creation and acceptance", () => {
  it("createTask → PENDING with the DELIVERY deadline (from creation) and deadline clamping", () => {
    const t = newTask(999 * WINDOWS.executionMax); // above the ceiling → clamped
    expect(t.status).toBe("PENDING");
    // Delivery deadline = creation + clamped duration (from CREATION = on-chain done_deadline from fund).
    expect(Date.parse(t.executionDeadline)).toBe(T0 + WINDOWS.executionMax);
  });

  it("accept → ACCEPTED; grace and delivery deadline are set at CREATION, accept doesn't reset them", () => {
    const t = accept(newTask(), T0 + 1000);
    expect(t.status).toBe("ACCEPTED");
    expect(Date.parse(t.graceUntil!)).toBe(T0 + WINDOWS.grace); // from creation (= on-chain accept_deadline), not from accept
    expect(Date.parse(t.executionDeadline)).toBe(T0 + WINDOWS.executionDefault); // from creation, not from accept
  });

  it("accept after the delivery deadline → ACCEPT_EXPIRED", () => {
    expect(throwsCode(() => accept(newTask(), T0 + WINDOWS.executionDefault + 1))).toBe(
      "ACCEPT_EXPIRED",
    );
  });

  it('reject → refund; cancel only within the grace window; not after "Done"', () => {
    expect(reject(newTask(), T0 + 1).resolution).toMatchObject({
      outcome: "to_donor",
      reason: "rejected",
    });
    const acc = accept(newTask(), T0);
    expect(cancel(acc, T0 + WINDOWS.grace - 1).resolution).toMatchObject({ reason: "canceled" });
    expect(throwsCode(() => cancel(acc, T0 + WINDOWS.grace + 1))).toBe("GRACE_OVER");
    const done = markDone(acc, TD);
    expect(throwsCode(() => cancel(done, TD + 1))).toBe("NOT_OPEN");
  });
});

describe("execution and dispute", () => {
  const accepted = () => accept(newTask(), T0);

  it("markDone → DONE with a dispute window (no proof)", () => {
    const d = markDone(accepted(), TD);
    expect(d.status).toBe("DONE");
    expect(Date.parse(d.disputeWindowEndsAt!)).toBe(TD + WINDOWS.disputeWindow);
  });

  it("markDone within the grace window → GRACE_ACTIVE (ESC-13: the streamer doesn't front-run the donor's cancel)", () => {
    expect(throwsCode(() => markDone(accepted(), T0 + WINDOWS.grace - 1))).toBe("GRACE_ACTIVE");
  });

  it("markDone after the deadline → EXEC_OVER (no-show logic — in dueResolution)", () => {
    expect(throwsCode(() => markDone(accepted(), T0 + WINDOWS.executionDefault + 1))).toBe(
      "EXEC_OVER",
    );
  });

  it("raiseDispute → DISPUTED; a repeated vote is rejected", () => {
    const done = markDone(accepted(), TD);
    let disp = raiseDispute(done, "Juror0", 100, TD + 1);
    expect(disp.status).toBe("DISPUTED");
    disp = castVote(disp, vote("JurorA", "completed", 30), TD + 2);
    expect(throwsCode(() => castVote(disp, vote("JurorA", "not_completed", 30), TD + 3))).toBe(
      "ALREADY_VOTED",
    );
  });
});

describe("vote tally by weight", () => {
  const disp = (votes: TaskVote[], quorum: number) => ({
    by: "J0",
    openedAt: "x",
    votingEndsAt: "x",
    quorum,
    votes,
  });

  it('weight "completed" > "not completed" → to the streamer (vote_completed)', () => {
    expect(tally(disp([vote("a", "completed", 60), vote("b", "not_completed", 40)], 50))).toEqual({
      outcome: "to_streamer",
      reason: "vote_completed",
    });
  });

  it('weight "not completed" greater → 100% to the donor (vote_not_completed)', () => {
    expect(tally(disp([vote("a", "not_completed", 70), vote("b", "completed", 30)], 50))).toEqual({
      outcome: "to_donor",
      reason: "vote_not_completed",
    });
  });

  it("total weight below quorum → to the streamer (no_quorum)", () => {
    expect(tally(disp([vote("a", "not_completed", 10)], 100))).toMatchObject({
      reason: "no_quorum",
      outcome: "to_streamer",
    });
  });

  it("tie by weight → to the streamer (presumption §11)", () => {
    expect(
      tally(disp([vote("a", "completed", 50), vote("b", "not_completed", 50)], 50)),
    ).toMatchObject({ reason: "tie", outcome: "to_streamer" });
  });
});

describe("resolution by time (dueResolution)", () => {
  it("PENDING after the window → refund to the donor (expired)", () => {
    expect(dueResolution(newTask(), T0 + WINDOWS.executionDefault + 1)).toMatchObject({
      reason: "expired",
      outcome: "to_donor",
    });
    expect(dueResolution(newTask(), T0 + 1)).toBeNull();
  });

  it("ACCEPTED after the deadline → no_show (refund to the donor)", () => {
    const acc = accept(newTask(), T0);
    expect(dueResolution(acc, T0 + WINDOWS.executionDefault + 1)).toMatchObject({
      reason: "no_show",
    });
  });

  it("DONE after the dispute window with no dispute → to the streamer (completed)", () => {
    const done = markDone(accept(newTask(), T0), TD);
    expect(dueResolution(done, TD + WINDOWS.disputeWindow + 1)).toMatchObject({
      reason: "completed",
      outcome: "to_streamer",
    });
  });
});

describe("reputation effects (ADR 0015)", () => {
  it("money to the streamer → the donor gets points for the delivered crown", () => {
    const fx = repEffects(newTask(), { outcome: "to_streamer", reason: "completed" });
    expect(fx).toEqual([{ address: "Donor1", type: "DONATION", pointsDelta: 5, amount: AMOUNT }]);
  });

  it("a refund to the donor by itself grants no points", () => {
    expect(repEffects(newTask(), { outcome: "to_donor", reason: "expired" })).toEqual([]);
  });

  it("lost dispute → penalty to the initiator; money to the streamer → donor +points", () => {
    const done = markDone(accept(newTask(), T0), TD);
    const disp = raiseDispute(done, "Juror0", 1, TD + 1);
    const fx = repEffects(disp, { outcome: "to_streamer", reason: "vote_completed" });
    expect(fx).toContainEqual({
      address: "Juror0",
      type: "DISPUTE_LOST",
      pointsDelta: -DISPUTE_LOSS_PENALTY,
    });
    expect(fx).toContainEqual({
      address: "Donor1",
      type: "DONATION",
      pointsDelta: 5,
      amount: AMOUNT,
    });
  });

  it("confirmed dispute (to the donor) → bonus to the initiator, no crown", () => {
    const done = markDone(accept(newTask(), T0), TD);
    const disp = raiseDispute(done, "Juror0", 1, TD + 1);
    const fx = repEffects(disp, { outcome: "to_donor", reason: "vote_not_completed" });
    expect(fx).toEqual([
      { address: "Juror0", type: "DISPUTE_WON", pointsDelta: DISPUTE_WIN_BONUS },
    ]);
  });
});

describe("claim (ADR 0015)", () => {
  it("only the recipient can claim, and only once", () => {
    const done = markDone(accept(newTask(), T0), TD);
    const resolved = {
      ...done,
      status: "RESOLVED" as const,
      resolution: {
        outcome: "to_streamer" as const,
        reason: "completed" as const,
        resolvedAt: "x",
        claimed: false,
      },
    };
    expect(throwsCode(() => claim(resolved, "Donor1", STREAMER, T0))).toBe("NOT_WINNER");
    const claimed = claim(resolved, STREAMER, STREAMER, T0);
    expect(claimed.resolution!.claimed).toBe(true);
    expect(throwsCode(() => claim(claimed, STREAMER, STREAMER, T0))).toBe("ALREADY_CLAIMED");
  });
});

describe("report (a viewer's report on the task text)", () => {
  it("you can't report your own task", () => {
    expect(throwsCode(() => report(newTask(), "Donor1", "spam", T0))).toBe("SELF_REPORT");
  });

  it("dedup by reporter — can't do it twice with the same one", () => {
    const t = report(newTask(), "Viewer1", "spam", T0);
    expect(t.reports).toHaveLength(1);
    expect(throwsCode(() => report(t, "Viewer1", "more", T0))).toBe("ALREADY_REPORTED");
  });

  it("REPORT_HIDE_THRESHOLD threshold of different reporters → text auto-hide (money untouched)", () => {
    let t = newTask();
    for (let i = 0; i < REPORT_HIDE_THRESHOLD - 1; i++) t = report(t, `V${i}`, undefined, T0);
    expect(t.textState).not.toBe("HIDDEN");
    t = report(t, `V${REPORT_HIDE_THRESHOLD - 1}`, undefined, T0);
    expect(t.reports).toHaveLength(REPORT_HIDE_THRESHOLD);
    expect(t.textState).toBe("HIDDEN");
    expect(t.status).toBe("PENDING"); // a report on the text doesn't move the stage/money
  });

  it("ESC-19: after accept reports do NOT mute the text (money ⟹ text visible) — they only accumulate", () => {
    let t = accept(newTask(), T0); // ACCEPTED + SHOWN (money may go to the streamer)
    for (let i = 0; i < REPORT_HIDE_THRESHOLD + 1; i++) t = report(t, `V${i}`, undefined, T0);
    expect(t.reports).toHaveLength(REPORT_HIDE_THRESHOLD + 1); // reports are recorded (a signal to the operator)
    expect(t.textState).toBe("SHOWN"); // but a paid task's text doesn't get muted
  });
});

describe("hide (streamer rejection — hide without resolve/on-chain)", () => {
  it("sets hidden; doesn't touch money/status/resolution", () => {
    const t = hide(newTask());
    expect(t.hidden).toBe(true);
    expect(t.status).toBe("PENDING");
    expect(t.resolution).toBeUndefined();
  });
  it("not allowed on a finished task", () => {
    const resolved = reject(newTask(), T0 + 1); // RESOLVED to_donor
    expect(throwsCode(() => hide(resolved))).toBe("NOT_OPEN");
  });
  it("ESC-19: can't reject an ACCEPTED task (money ⟹ task visible)", () => {
    expect(throwsCode(() => hide(accept(newTask(), T0)))).toBe("NOT_OPEN");
  });
});

describe("operator takedown (operatorBlocked) — overrides publication", () => {
  it("isTextPublic=false even if the text is SHOWN (removed by the platform operator)", () => {
    const shown = { ...accept(newTask(), T0), textState: "SHOWN" as const };
    expect(isTextPublic(shown)).toBe(true);
    expect(isTextPublic({ ...shown, operatorBlocked: true })).toBe(false);
  });
});
