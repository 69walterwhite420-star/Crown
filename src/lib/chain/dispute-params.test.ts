import { describe, expect, it } from "vitest";
import { buildDisputeParamsMessage, normalizeDisputeParams } from "./dispute-params";

describe("dispute-params (cross-language pin with the canister)", () => {
  /**
   * THE SAME string as in the Rust test `governance.rs::canonical_message_pinned`.
   * If they diverge, a signature from the space stops being accepted by the canister. Change only as a pair + `v:`.
   */
  it("canonical message matches Rust byte-for-byte", () => {
    const msg = buildDisputeParamsMessage("chan-1", "OWNER", 1, {
      minReputationToDisputeMicro: 1_000_000n,
      minWeightToVoteMicro: 1_000_000n,
      quorumMicro: 1_000_000n,
      disputeWindowSecs: 120,
      votingWindowSecs: 120,
      dMaxMicro: 0n,
      disputeWinBonusMicro: 10_000_000n,
      disputeLossPenaltyMicro: 50_000_000n,
    });
    const expected =
      "Standing: realm dispute parameters.\n\nBy signing, you set the dispute rules for your realm.\nChanges take effect after the timelock — ongoing disputes play out under the previous rules.\n\nchannel: chan-1\nowner: OWNER\nversion: 1\nminReputationToDisputeMicro: 1000000\nminWeightToVoteMicro: 1000000\nquorumMicro: 1000000\ndisputeWindowSecs: 120\nvotingWindowSecs: 120\ndMaxMicro: 0\ndisputeWinBonusMicro: 10000000\ndisputeLossPenaltyMicro: 50000000\nv: 3";
    expect(msg).toBe(expected);
  });

  it("normalizing the canister response: money strings → bigint, ns → ms", () => {
    const info = normalizeDisputeParams({
      channelId: "c",
      owner: "O",
      version: 1,
      isDefault: false,
      effective: {
        minReputationToDisputeMicro: 1_000_000,
        minWeightToVoteMicro: 1_000_000,
        quorumMicro: 1_000_000,
        disputeWindowSecs: 120,
        votingWindowSecs: 120,
        dMaxMicro: "0",
        disputeWinBonusMicro: 10_000_000,
        disputeLossPenaltyMicro: 50_000_000,
      },
      pending: {
        params: {
          minReputationToDisputeMicro: 2_000_000,
          minWeightToVoteMicro: 1_000_000,
          quorumMicro: "1000000",
          disputeWindowSecs: 180,
          votingWindowSecs: 300,
          dMaxMicro: "50000000",
          disputeWinBonusMicro: "15000000",
          disputeLossPenaltyMicro: "60000000",
        },
        effectiveAtNs: "1783176899623489861",
        version: 1,
      },
    });
    expect(info.effective.dMaxMicro).toBe(0n);
    expect(info.pending?.params.dMaxMicro).toBe(50_000_000n);
    expect(info.pending?.effectiveAtMs).toBe(1783176899623);
  });
});
