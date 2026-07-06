import { describe, expect, it } from "vitest";
import { buildOpenDisputeMessage, buildVoteMessage } from "./dispute-vote";

describe("dispute-vote (cross-language pin with the canister)", () => {
  /** THE SAME strings as in the Rust test `arbiter.rs::canonical_messages_pinned`. Change only as a pair. */
  it("the dispute-opening message matches Rust byte-for-byte", () => {
    expect(buildOpenDisputeMessage("ESCROW", "chan-1", "BY")).toBe(
      "Standing: opening a dispute over a Crown-task.\n\nBy signing, you dispute completion of the task. This costs no money,\nbut a lost false dispute will deduct 50 points of your Reign.\n\nescrow: ESCROW\nchannel: chan-1\nby: BY\nv: 2",
    );
  });

  it("the vote message matches Rust byte-for-byte", () => {
    expect(buildVoteMessage("ESCROW", "chan-1", "VOTER", "not_completed")).toBe(
      "Standing: a vote in a dispute over a Crown-task.\n\nBy signing, you vote with the weight of your Reign on this realm.\n\nescrow: ESCROW\nchannel: chan-1\nvoter: VOTER\nchoice: not_completed\nv: 1",
    );
  });
});
