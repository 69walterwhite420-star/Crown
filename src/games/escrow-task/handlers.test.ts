import { describe, expect, it } from "vitest";
import { taskTextCommitment } from "@/lib/data/moderation";
import { dispatchGame, type GameContext, type GameLedgerEntry } from "../bus";
import { escrowTaskHandlers } from "./handlers";
import { WINDOWS } from "./machine";
import type { EscrowTask } from "./types";

/**
 * Integration tests of the "task-for-a-crown" handlers through the game-bus: the full cycle (happy-path and a dispute),
 * banking of reputation effects on claim, and authorization. We fake the store with a closure (state slice +
 * a ledger sink + a controllable clock + a reputation map), as a provider would.
 */

const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const STREAMER = "Streamer";
const AMOUNT = "5000000"; // 5 USDC → 5 points; quorum = 5
const TD = T0 + WINDOWS.grace + 2; // "Done" — right after the donor's cancel grace (ESC-13)

function harness(
  rep: Record<string, number> = {},
  channelPayout: string | null = "Payout1",
  escrowOutcome?: GameContext["escrowOutcome"],
  // Default auto_if_clean → the task is SHOWN immediately, so lifecycle tests can accept without an explicit show.
  // Moderation tests pass "manual" (then HELD).
  textShowMode: GameContext["textShowMode"] = "auto_if_clean",
  escrowState?: GameContext["escrowState"], // ESC-19: raw on-chain state (for testing reveal on accept)
  isContentBlocked?: GameContext["isContentBlocked"], // operator takedown (platform moderation)
  minTaskAmountMicro = "0", // the channel's minimum for tasks (§10 lever; the BELOW_MIN test passes its own)
  // CR-4: by default the commitment check is off (all other tests); the commitment test sets a real one.
  verifyTextCommitment: GameContext["verifyTextCommitment"] = async () => true,
  minReputationToTask = 0, // §10: reputation threshold to submit a task (the threshold test passes its own)
  minReputationToDispute = 1, // §10: reputation threshold for the right to raise a dispute (fixture default = 1)
  channelPayoutAttested = true, // H1: payout confirmed by the owner's signature (the PAYOUT_UNATTESTED test sets false)
) {
  let slice: unknown;
  let counter = 0;
  const ledger: GameLedgerEntry[] = [];
  const ctx = (identity: string | null, t: number): GameContext => ({
    identity,
    channelId: "ch-1",
    channelOwner: STREAMER,
    channelPayout,
    channelPayoutAttested,
    isChannelManager: identity === STREAMER, // manager = owner (no moderators in the harness)
    minTaskAmountMicro,
    minReputationToTask,
    minReputationToDispute,
    textMaxLen: 200, // core fixture default (messageMaxLen)
    escrowOutcome,
    now: () => new Date(t).toISOString(),
    newId: () => `task-${++counter}`,
    state: {
      get: <T = unknown>() => slice as T | undefined,
      set: (v: unknown) => {
        slice = v;
      },
    },
    reputationAsOf: (address) => rep[address] ?? 0,
    bankLedger: (entries) => ledger.push(...entries),
    moderate: async (text) => (/kill|steal/i.test(text) ? "HARD_BLOCK" : "CLEAR"),
    verifyEscrow: async () => true,
    verifyTextCommitment, // CR-4: default true; the commitment test passes a real check
    textShowMode,
    escrowState,
    isContentBlocked,
  });
  const run = (identity: string | null, t: number, op: string, payload?: unknown) =>
    dispatchGame(
      { "escrow-task": escrowTaskHandlers },
      "escrow-task",
      "action",
      op,
      ctx(identity, t),
      payload,
    );
  const query = (op: string, payload?: unknown) =>
    dispatchGame(
      { "escrow-task": escrowTaskHandlers },
      "escrow-task",
      "query",
      op,
      ctx(null, T0),
      payload,
    );
  // A query on behalf of a specific caller — for tests of server-side redaction of private text (§4.6).
  const queryAs = (identity: string | null, op: string, payload?: unknown) =>
    dispatchGame(
      { "escrow-task": escrowTaskHandlers },
      "escrow-task",
      "query",
      op,
      ctx(identity, T0),
      payload,
    );
  return { run, query, queryAs, ledger };
}

describe("happy-path: created → accepted → done → (window passed) → claim by the streamer", () => {
  it("money to the streamer, donor +points for the delivered crown", async () => {
    const h = harness();
    const created = (await h.run("Donor", T0, "create", {
      amount: AMOUNT,
      text: "do X",
    })) as EscrowTask;
    expect(created.status).toBe("PENDING");
    await h.run(STREAMER, T0 + 1, "accept", { taskId: created.id });
    await h.run(STREAMER, TD, "markDone", { taskId: created.id });

    // the dispute window passed → the streamer claims
    const claimed = (await h.run(STREAMER, TD + WINDOWS.disputeWindow + 1, "claim", {
      taskId: created.id,
    })) as EscrowTask;
    expect(claimed.resolution).toMatchObject({
      outcome: "to_streamer",
      reason: "completed",
      claimed: true,
    });
    expect(h.ledger).toEqual([
      { address: "Donor", type: "DONATION", pointsDelta: 5, amount: AMOUNT },
    ]);
  });
});

describe("settleDue: background time-based resolve banks reputation without a claim (permissionless)", () => {
  it("DONE with no dispute after the window → DONATION to the donor, idempotent", async () => {
    const h = harness();
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "X" })) as EscrowTask;
    await h.run(STREAMER, T0 + 1, "accept", { taskId: t.id });
    await h.run(STREAMER, TD, "markDone", { taskId: t.id });

    // The dispute window passed → the settler (no identity) resolves and banks, without waiting for a claim.
    const r1 = (await h.run(null, TD + WINDOWS.disputeWindow + 1, "settleDue")) as {
      settled: number;
    };
    expect(r1.settled).toBe(1);
    expect(h.ledger).toEqual([
      { address: "Donor", type: "DONATION", pointsDelta: 5, amount: AMOUNT },
    ]);

    // A repeat run — nothing new (idempotent: already RESOLVED).
    const r2 = (await h.run(null, TD + WINDOWS.disputeWindow + 2, "settleDue")) as {
      settled: number;
    };
    expect(r2.settled).toBe(0);
    expect(h.ledger).toHaveLength(1);
  });
});

describe("ESC-14: a claim by a non-recipient doesn't re-mint reputation", () => {
  it("repeated claim by the donor (not the winner) banks DONATION EXACTLY once", async () => {
    const h = harness();
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "X" })) as EscrowTask;
    await h.run(STREAMER, T0 + 1, "accept", { taskId: t.id });
    await h.run(STREAMER, TD, "markDone", { taskId: t.id });
    const at = TD + WINDOWS.disputeWindow + 1; // outcome to_streamer → the winner is the streamer, not the donor
    // The donor (NOT the winner) hammers claim: the first time resolves+banks, then the task is already RESOLVED → only
    // NOT_WINNER without re-banking. Before the fix each call minted DONATION (the status wasn't persisted).
    for (let i = 0; i < 3; i++)
      await expect(h.run("Donor", at, "claim", { taskId: t.id })).rejects.toMatchObject({
        code: "NOT_WINNER",
      });
    expect(h.ledger).toEqual([
      { address: "Donor", type: "DONATION", pointsDelta: 5, amount: AMOUNT },
    ]);
  });
});

describe("M3: a chain-backed task is banked ONLY on a known on-chain outcome", () => {
  // Mature a task with escrowTaskId to to_streamer (DONE + dispute window passed), vary escrowOutcome.
  const mature = async (h: ReturnType<typeof harness>) => {
    const t = (await h.run("Donor", T0, "create", {
      amount: AMOUNT,
      text: "X",
      escrowTaskId: "abc123",
    })) as EscrowTask;
    await h.run(STREAMER, T0 + 1, "accept", { taskId: t.id });
    await h.run(STREAMER, TD, "markDone", { taskId: t.id });
    return { t, at: TD + WINDOWS.disputeWindow + 1 };
  };

  it("outcome unknown (escrow closed, indexer hasn't recorded yet) → does NOT bank, defers", async () => {
    const h = harness({}, "Payout1", async () => null);
    const { at } = await mature(h);
    const r = (await h.run(null, at, "settleDue")) as { settled: number };
    expect(r.settled).toBe(0); // deferred — no off-chain timer
    expect(h.ledger).toEqual([]);
  });

  it("indexer recorded a claim → to_streamer → banks DONATION to the donor (money truth)", async () => {
    const h = harness({}, "Payout1", async () => "to_streamer");
    const { at } = await mature(h);
    const r = (await h.run(null, at, "settleDue")) as { settled: number };
    expect(r.settled).toBe(1);
    expect(h.ledger).toEqual([
      { address: "Donor", type: "DONATION", pointsDelta: 5, amount: AMOUNT },
    ]);
  });
});

describe("ESC-18 / ESC-6: binding the on-chain escrow to the channel", () => {
  it("ESC-18: a repeated escrowTaskId is rejected (one mirror per payment)", async () => {
    const h = harness();
    await h.run("Donor", T0, "create", { amount: AMOUNT, text: "X", escrowTaskId: "abc123" });
    await expect(
      h.run("Donor", T0 + 1, "create", { amount: AMOUNT, text: "Y", escrowTaskId: "abc123" }),
    ).rejects.toMatchObject({ code: "ESCROW_REUSED" });
  });

  it("ESC-6 fail-closed: a chain escrow without the channel's payout is rejected", async () => {
    const h = harness({}, null); // channel without payoutAddress
    await expect(
      h.run("Donor", T0, "create", { amount: AMOUNT, text: "X", escrowTaskId: "abc123" }),
    ).rejects.toMatchObject({ code: "NO_PAYOUT" });
  });

  it("H1 fail-closed: a chain escrow to a signature-UNconfirmed payout is rejected", async () => {
    // payout exists but isn't attested by the owner (last positional arg = false). The server guard holds
    // even if the client (chain-provider.assertPayoutAttested) is bypassed with a hand-built request.
    const h = harness(
      {},
      "Payout1",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
    );
    await expect(
      h.run("Donor", T0, "create", { amount: AMOUNT, text: "X", escrowTaskId: "abc123" }),
    ).rejects.toMatchObject({ code: "PAYOUT_UNATTESTED" });
  });

  it("H1: an UNattested payout does NOT block a mock/api task (no escrowTaskId — no money on-chain)", async () => {
    const h = harness(
      {},
      "Payout1",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
    );
    // Without escrowTaskId the H1 guard doesn't fire: this is a simulation with no on-chain money (parity with ESC-6/verifyEscrow).
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "X" })) as EscrowTask;
    expect(t.status).toBe("PENDING");
  });
});

describe('dispute: the community decides "not completed" → refund to the donor', async () => {
  it("the donor claims 100%, the dispute initiator gets a bonus, no crown", async () => {
    const h = harness({ Disputer: 1, JurorA: 4, JurorB: 3 });
    const t = (await h.run("Donor", T0, "create", {
      amount: AMOUNT,
      text: "do X",
    })) as EscrowTask;
    await h.run(STREAMER, T0 + 1, "accept", { taskId: t.id });
    await h.run(STREAMER, TD, "markDone", { taskId: t.id });
    await h.run("Disputer", TD + 1, "raiseDispute", { taskId: t.id });
    await h.run("JurorA", TD + 2, "vote", { taskId: t.id, choice: "not_completed" });
    await h.run("JurorB", TD + 3, "vote", { taskId: t.id, choice: "not_completed" });

    const claimed = (await h.run("Donor", TD + 1 + WINDOWS.voting + 1, "claim", {
      taskId: t.id,
    })) as EscrowTask;
    expect(claimed.resolution).toMatchObject({
      outcome: "to_donor",
      reason: "vote_not_completed",
      claimed: true,
    });
    expect(h.ledger).toEqual([{ address: "Disputer", type: "DISPUTE_WON", pointsDelta: 10 }]);
  });
});

describe("authorization", () => {
  it("only the channel owner can accept; the donor doesn't vote in their own dispute", async () => {
    const h = harness({ Disputer: 1 });
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "X" })) as EscrowTask;
    await expect(h.run("Donor", T0 + 1, "accept", { taskId: t.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await h.run(STREAMER, T0 + 1, "accept", { taskId: t.id });
    await h.run(STREAMER, TD, "markDone", { taskId: t.id });
    await h.run("Disputer", TD + 1, "raiseDispute", { taskId: t.id });
    await expect(
      h.run("Donor", TD + 2, "vote", { taskId: t.id, choice: "completed" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("query list returns the channel's tasks", async () => {
    const h = harness();
    await h.run("Donor", T0, "create", { amount: AMOUNT, text: "X" });
    const res = (await h.query("list")) as { tasks: EscrowTask[] };
    expect(res.tasks).toHaveLength(1);
    expect(res.tasks[0]!.text).toBe("X");
  });

  it("an illegal task isn't created (moderation HARD_BLOCK)", async () => {
    const h = harness();
    await expect(
      h.run("Donor", T0, "create", { amount: AMOUNT, text: "kill that guy" }),
    ).rejects.toMatchObject({ code: "ILLEGAL_TASK" });
    expect(((await h.query("list")) as { tasks: EscrowTask[] }).tasks).toHaveLength(0);
  });
});

describe("disputeVotes — paginated, filter by side, search, aggregate (scale)", () => {
  type Result = {
    found: boolean;
    total: number;
    votes: { voter: string; choice: string; weight: number }[];
    dispute?: {
      tally: { completed: number; not: number; completedVotes: number; notVotes: number };
    };
  };

  async function disputed() {
    const h = harness({ Disp: 1, A: 5, B: 3, C: 2 });
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "X" })) as EscrowTask;
    await h.run(STREAMER, T0 + 1, "accept", { taskId: t.id });
    await h.run(STREAMER, TD, "markDone", { taskId: t.id });
    await h.run("Disp", TD + 1, "raiseDispute", { taskId: t.id });
    await h.run("A", TD + 2, "vote", { taskId: t.id, choice: "completed" });
    await h.run("B", TD + 3, "vote", { taskId: t.id, choice: "completed" });
    await h.run("C", TD + 4, "vote", { taskId: t.id, choice: "not_completed" });
    return { h, taskId: t.id };
  }

  it("page + sort by weight + aggregate over ALL votes", async () => {
    const { h, taskId } = await disputed();
    const r = (await h.query("disputeVotes", {
      taskId,
      page: 0,
      pageSize: 2,
      sort: "weight",
    })) as Result;
    expect(r.total).toBe(3);
    expect(r.votes.map((v) => v.voter)).toEqual(["A", "B"]); // weight 5,3 — first page of 2
    expect(r.dispute!.tally).toMatchObject({
      completed: 8,
      not: 2,
      completedVotes: 2,
      notVotes: 1,
    });
  });

  it("filter by side and search by address", async () => {
    const { h, taskId } = await disputed();
    const onlyNot = (await h.query("disputeVotes", { taskId, side: "not_completed" })) as Result;
    expect(onlyNot.total).toBe(1);
    expect(onlyNot.votes[0]!.voter).toBe("C");
    const search = (await h.query("disputeVotes", { taskId, q: "a" })) as Result;
    expect(search.votes.every((v) => v.voter.toLowerCase().includes("a"))).toBe(true);
  });

  it("no dispute → found:false", async () => {
    const h = harness();
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "X" })) as EscrowTask;
    expect(((await h.query("disputeVotes", { taskId: t.id })) as Result).found).toBe(false);
  });
});

describe("task-text moderation queue (textState)", () => {
  it('manual → HELD; streamer "Show" → SHOWN; outsider → FORBIDDEN', async () => {
    const h = harness({}, "Payout1", undefined, "manual");
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "do X" })) as EscrowTask;
    expect(t.textState).toBe("HELD"); // into the queue, not onto the page
    await expect(
      h.run("NotOwner", T0, "setTextState", { taskId: t.id, state: "SHOWN" }),
    ).rejects.toThrow(); // owner only
    const shown = (await h.run(STREAMER, T0, "setTextState", {
      taskId: t.id,
      state: "SHOWN",
    })) as EscrowTask;
    expect(shown.textState).toBe("SHOWN");
    expect(shown.status).toBe("PENDING"); // text moderation doesn't move money/status (§7)
  });

  it("auto_if_clean + clean text → immediately SHOWN (no queue)", async () => {
    const h = harness({}, "Payout1", undefined, "auto_if_clean");
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "do X" })) as EscrowTask;
    expect(t.textState).toBe("SHOWN");
  });

  it('"Show" after the timer expires is forbidden (TEXT_LOCKED) — too late to publish', async () => {
    const h = harness({}, "Payout1", undefined, "manual");
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "do X" })) as EscrowTask;
    // The delivery deadline passed (PENDING → expired, goes to a refund to the donor) → can no longer show the text.
    await expect(
      h.run(STREAMER, T0 + WINDOWS.executionDefault + 1, "setTextState", { taskId: t.id, state: "SHOWN" }),
    ).rejects.toMatchObject({ code: "TEXT_LOCKED" });
  });

  it("ESC-19: accept REVEALS the text — HELD → accept makes ACCEPTED + SHOWN", async () => {
    const h = harness({}, "Payout1", undefined, "manual");
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "do X" })) as EscrowTask;
    expect(t.textState).toBe("HELD");
    const accepted = (await h.run(STREAMER, T0 + 1, "accept", { taskId: t.id })) as EscrowTask;
    expect(accepted.status).toBe("ACCEPTED");
    expect(accepted.textState).toBe("SHOWN"); // acceptance publishes the text
  });

  it('ESC-19: after accept "hide" the text is forbidden (TEXT_LOCKED) — money ⟹ text visible', async () => {
    const h = harness({}, "Payout1", undefined, "auto_if_clean");
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "do X" })) as EscrowTask;
    // Before accept hiding is allowed (no money to the streamer yet).
    const hidden = (await h.run(STREAMER, T0, "setTextState", {
      taskId: t.id,
      state: "HIDDEN",
    })) as EscrowTask;
    expect(hidden.textState).toBe("HIDDEN");
    // Accept — the text is public again; now it can't be hidden.
    await h.run(STREAMER, T0 + 1, "accept", { taskId: t.id });
    await expect(
      h.run(STREAMER, T0 + 2, "setTextState", { taskId: t.id, state: "HIDDEN" }),
    ).rejects.toMatchObject({ code: "TEXT_LOCKED" });
  });

  it("ESC-19: on-chain accept (escrowState=Accepted) → settleDue reveals the text BYPASSING the UI", async () => {
    const h = harness({}, "Payout1", undefined, "manual", async () => 1); // 1 = Accepted on-chain
    const t = (await h.run("Donor", T0, "create", {
      amount: AMOUNT,
      text: "do X",
      escrowTaskId: "abc123",
    })) as EscrowTask;
    expect(t.textState).toBe("HELD");
    await h.run(null, T0 + 1, "settleDue"); // background settler (no identity) — like the indexer
    const after = (await h.query("get", { taskId: t.id })) as EscrowTask;
    expect(after.textState).toBe("SHOWN"); // the indexer saw the on-chain accept and revealed the text
  });

  it('ESC-19: "Reject" (hidden) + on-chain accept BYPASSING the UI → settleDue returns the task to the feed', async () => {
    const h = harness({}, "Payout1", undefined, "auto_if_clean", async () => 1); // 1 = Accepted on-chain
    const t = (await h.run("Donor", T0, "create", {
      amount: AMOUNT,
      text: "do X",
      escrowTaskId: "abc123",
    })) as EscrowTask;
    // The streamer "rejected" (hid it from the feed), counting on a refund by timer…
    const hidden = (await h.run(STREAMER, T0, "hide", { taskId: t.id })) as EscrowTask;
    expect(hidden.hidden).toBe(true);
    // …but then accepted the escrow DIRECTLY on-chain (bypassing the site) and aims to take the money.
    await h.run(null, T0 + 1, "settleDue"); // the indexer sees the accept on-chain
    const after = (await h.query("get", { taskId: t.id })) as EscrowTask;
    expect(after.hidden).toBe(false); // the task returned to the feed — the community will see it and can dispute it
    expect(after.textState).toBe("SHOWN");
    expect(after.status).toBe("ACCEPTED");
  });

  it("operator takedown OVERRIDES auto-reveal: settleDue doesn't reveal, list marks operatorBlocked", async () => {
    const blocked = new Set<string>();
    // escrowState=1 (Accepted) — normally the indexer would reveal the text; but the operator pulled the task.
    const h = harness({}, "Payout1", undefined, "manual", async () => 1, (id) => blocked.has(id));
    const t = (await h.run("Donor", T0, "create", {
      amount: AMOUNT,
      text: "do X",
      escrowTaskId: "abc123",
    })) as EscrowTask;
    blocked.add(t.id); // the operator pulled the content from publication
    await h.run(null, T0 + 1, "settleDue"); // the indexer sees the on-chain accept…
    const after = (await h.query("get", { taskId: t.id })) as EscrowTask;
    expect(after.textState).toBe("HELD"); // …but the text is NOT revealed — the takedown overrides the reveal
    expect(after.operatorBlocked).toBe(true); // the query marks the pulled content (isTextPublic → false in the UI)
  });
});

describe('hide ("Reject" = hide without on-chain/resolve; refund by timer)', () => {
  it("the owner hides → hidden=true without a resolve; outsider → FORBIDDEN", async () => {
    const h = harness();
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "X" })) as EscrowTask;
    await expect(h.run("NotOwner", T0, "hide", { taskId: t.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const hidden = (await h.run(STREAMER, T0, "hide", { taskId: t.id })) as EscrowTask;
    expect(hidden.hidden).toBe(true);
    expect(hidden.status).toBe("PENDING"); // we don't resolve — the escrow returns to the donor on its own by timer
    expect(hidden.resolution).toBeUndefined();
  });
});

describe("channel levers on create (spec §10, parity with createDonation)", () => {
  it("BELOW_MIN: the amount is below the channel's minimum for tasks", async () => {
    // minimum 10 USDC, crown 5 USDC (AMOUNT) → rejected BEFORE recording
    const h = harness({}, "Payout1", undefined, "auto_if_clean", undefined, undefined, "10000000");
    await expect(
      h.run("Donor", T0, "create", { amount: AMOUNT, text: "do X" }),
    ).rejects.toMatchObject({ code: "BELOW_MIN" });
    expect(((await h.query("list")) as { tasks: EscrowTask[] }).tasks).toHaveLength(0);
  });

  it("TOO_LONG: the task text is longer than the channel's limit (messageMaxLen)", async () => {
    const h = harness();
    await expect(
      h.run("Donor", T0, "create", { amount: AMOUNT, text: "x".repeat(201) }),
    ).rejects.toMatchObject({ code: "TOO_LONG" });
  });
});

describe("server-side redaction of a task's private text (§4.6, parity with redactDonation)", () => {
  it("HELD text is seen by the donor and the channel manager; an outsider and an anon — not", async () => {
    const h = harness({}, "Payout1", undefined, "manual"); // manual → the task is created HELD
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "secret" })) as EscrowTask;
    expect(t.textState).toBe("HELD");

    const anon = (await h.queryAs(null, "get", { taskId: t.id })) as EscrowTask;
    expect(anon.text).toBe(""); // anon — the text is stripped by the server
    const stranger = (await h.queryAs("Stranger", "get", { taskId: t.id })) as EscrowTask;
    expect(stranger.text).toBe(""); // outsider — stripped
    const donor = (await h.queryAs("Donor", "get", { taskId: t.id })) as EscrowTask;
    expect(donor.text).toBe("secret"); // the author sees their own
    const manager = (await h.queryAs(STREAMER, "get", { taskId: t.id })) as EscrowTask;
    expect(manager.text).toBe("secret"); // the channel manager sees the queue

    const list = (await h.queryAs("Stranger", "list")) as { tasks: EscrowTask[] };
    expect(list.tasks[0]!.text).toBe(""); // list is redacted by the same logic
  });

  it("operator takedown hides the text from EVERYONE, including the manager (overrides the role)", async () => {
    const blocked = new Set<string>();
    const h = harness({}, "Payout1", undefined, "auto_if_clean", undefined, (id) =>
      blocked.has(id),
    );
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "something bad" })) as EscrowTask;
    blocked.add(t.id);
    const manager = (await h.queryAs(STREAMER, "get", { taskId: t.id })) as EscrowTask;
    expect(manager.operatorBlocked).toBe(true);
    expect(manager.text).toBe(""); // even the manager can't see operator-pulled content
    const donor = (await h.queryAs("Donor", "get", { taskId: t.id })) as EscrowTask;
    expect(donor.text).toBe("");
  });
});

describe("CR-4: on-chain commitment to the task text (task_id = SHA-256(nonce ‖ text))", () => {
  // A real crypto check (as in the mock provider): task_id must match the commitment to the text.
  const realVerify: GameContext["verifyTextCommitment"] = async (id, text, nonce) =>
    !!nonce && (await taskTextCommitment(text, nonce)) === id;

  it("matching commitment → the task is created", async () => {
    const h = harness({}, "Payout1", undefined, "auto_if_clean", undefined, undefined, "0", realVerify);
    const nonce = "0123456789abcdef0123456789abcdef";
    const text = "sing a song on stream";
    const escrowTaskId = await taskTextCommitment(text, nonce);
    const t = (await h.run("Donor", T0, "create", {
      amount: AMOUNT,
      text,
      escrowTaskId,
      textNonce: nonce,
    })) as EscrowTask;
    expect(t.escrowTaskId).toBe(escrowTaskId);
    expect(t.textNonce).toBe(nonce);
  });

  it("swapped text under the same escrow → ESCROW_TEXT_MISMATCH (operator/client can't substitute another text)", async () => {
    const h = harness({}, "Payout1", undefined, "auto_if_clean", undefined, undefined, "0", realVerify);
    const nonce = "0123456789abcdef0123456789abcdef";
    const escrowTaskId = await taskTextCommitment("an honest task", nonce);
    await expect(
      h.run("Donor", T0, "create", {
        amount: AMOUNT,
        text: "a completely different task", // not the text baked into task_id
        escrowTaskId,
        textNonce: nonce,
      }),
    ).rejects.toMatchObject({ code: "ESCROW_TEXT_MISMATCH" });
  });

  it("no nonce on a chain task → fail-closed (ESCROW_TEXT_MISMATCH)", async () => {
    const h = harness({}, "Payout1", undefined, "auto_if_clean", undefined, undefined, "0", realVerify);
    const escrowTaskId = await taskTextCommitment("task", "0123456789abcdef0123456789abcdef");
    await expect(
      h.run("Donor", T0, "create", { amount: AMOUNT, text: "task", escrowTaskId }),
    ).rejects.toMatchObject({ code: "ESCROW_TEXT_MISMATCH" });
  });
});

describe("§10: reputation thresholds for task/dispute (streamer levers, anti-spam)", () => {
  it("minimum reputation for a task: a zero wallet is cut off, with standing — passes", async () => {
    // threshold of 5 points to submit a task
    const h = harness(
      { Rich: 10 }, "Payout1", undefined, "auto_if_clean", undefined, undefined, "0",
      async () => true, 5 /* minReputationToTask */,
    );
    await expect(
      h.run("Poor", T0, "create", { amount: AMOUNT, text: "do X" }),
    ).rejects.toMatchObject({ code: "LOW_REP" }); // rep 0 < 5
    const t = (await h.run("Rich", T0, "create", { amount: AMOUNT, text: "do X" })) as EscrowTask;
    expect(t.status).toBe("PENDING"); // rep 10 ≥ 5
  });

  it("threshold 0 = no threshold: a zero wallet creates a task", async () => {
    const h = harness(); // minReputationToTask default 0
    const t = (await h.run("Poor", T0, "create", { amount: AMOUNT, text: "X" })) as EscrowTask;
    expect(t.status).toBe("PENDING");
  });

  it("the dispute threshold is set by the streamer: rep below the threshold can't raise a dispute", async () => {
    const h = harness(
      { Weak: 3, Strong: 5 }, "Payout1", undefined, "auto_if_clean", undefined, undefined, "0",
      async () => true, 0 /* task */, 5 /* dispute threshold */,
    );
    const t = (await h.run("Donor", T0, "create", { amount: AMOUNT, text: "X" })) as EscrowTask;
    await h.run(STREAMER, T0 + 1, "accept", { taskId: t.id });
    await h.run(STREAMER, TD, "markDone", { taskId: t.id });
    await expect(
      h.run("Weak", TD + 1, "raiseDispute", { taskId: t.id }),
    ).rejects.toMatchObject({ code: "LOW_REP" }); // 3 < 5
    const disputed = (await h.run("Strong", TD + 2, "raiseDispute", { taskId: t.id })) as EscrowTask;
    expect(disputed.status).toBe("DISPUTED"); // 5 ≥ 5
  });
});
