import { describe, expect, it } from "vitest";
import { OPERATOR_ADDRESS } from "../chain/addresses";
import { MockDataProvider } from "./mock-provider";

/**
 * Operator sanctions (platform moderation): full wallet ban and target validation. Content takedown
 * (removing a task/message) is checked at the game level in handlers.test.ts (isContentBlocked); here — that
 * the provider actually GATES a banned wallet, requires a target for a sanction, and that a ban survives snapshot/restore
 * (rebuilding override sets from the journal). Sanctions don't touch on-chain money (§4.1/§4.2) — off-chain only.
 */

const OP = OPERATOR_ADDRESS as string; // in tests = TREASURY_OWNER (devnet default)
const W = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"; // an arbitrary base58 "wallet"
const PAYOUT = "9tSWouwVrPahnnLW4AMQcNn53Uk5okFEdduo1M3Gtrpe";

function provider() {
  const p = new MockDataProvider();
  p.__setLatencyScale(0); // no artificial gate() delay
  return p;
}

describe("operator sanctions (applyOperatorAction)", () => {
  it("BAN_WALLET_FULL gates createChannel; REINSTATE by address lifts the ban", async () => {
    const p = provider();
    p.__setAddress(OP);
    await p.applyOperatorAction({ action: "BAN_WALLET_FULL", targetAddress: W, reason: "sanctions" });

    p.__setAddress(W);
    await expect(
      p.createChannel({ handle: "victim1", payoutAddress: PAYOUT }),
    ).rejects.toMatchObject({ code: "WALLET_BANNED" });

    p.__setAddress(OP);
    await p.applyOperatorAction({
      action: "REINSTATE_CHANNEL",
      targetAddress: W,
      reason: "false positive",
    });
    p.__setAddress(W);
    const ch = await p.createChannel({ handle: "victim1", payoutAddress: PAYOUT });
    expect(ch.handle).toBe("victim1"); // ban lifted — the wallet can create a realm again
  });

  it("sanction without the required target → BAD_TARGET (not a silent no-op)", async () => {
    const p = provider();
    p.__setAddress(OP);
    await expect(
      p.applyOperatorAction({ action: "HIDE_MESSAGE", reason: "csam" }),
    ).rejects.toMatchObject({ code: "BAD_TARGET" });
    await expect(
      p.applyOperatorAction({ action: "BAN_WALLET_FULL", reason: "x" }),
    ).rejects.toMatchObject({ code: "BAD_TARGET" });
    await expect(
      p.applyOperatorAction({ action: "CHANNEL_BLOCK", targetChannelId: "ch-x", reason: "x" }),
    ).rejects.toMatchObject({ code: "BAD_TARGET" });
  });

  it("a wallet ban survives snapshot/restore (the override set is rebuilt from the journal)", async () => {
    const p = provider();
    p.__setAddress(OP);
    await p.applyOperatorAction({ action: "BAN_WALLET_FULL", targetAddress: W, reason: "sanctions" });
    const snap = p.__snapshot();

    const p2 = provider();
    p2.__restore(snap); // restore rebuilds bannedWallets from operatorActions
    p2.__setAddress(W);
    await expect(
      p2.createChannel({ handle: "victim2", payoutAddress: PAYOUT }),
    ).rejects.toMatchObject({ code: "WALLET_BANNED" });
  });

  it("only the operator can apply sanctions (anyone else → FORBIDDEN)", async () => {
    const p = provider();
    p.__setAddress(W); // not the operator
    await expect(
      p.applyOperatorAction({ action: "BAN_WALLET_FULL", targetAddress: W, reason: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
