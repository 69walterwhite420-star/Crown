import bs58 from "bs58";
import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import { buildPayoutAttestationMessage, verifyPayoutAttestation } from "./attestation";

/** Signing the message with a real ed25519 key — what the owner's wallet does (signMessage). */
function sign(owner: nacl.SignKeyPair, payout: string): string {
  const msg = new TextEncoder().encode(
    buildPayoutAttestationMessage(bs58.encode(owner.publicKey), payout),
  );
  return Buffer.from(nacl.sign.detached(msg, owner.secretKey)).toString("base64");
}

describe("payout attestation (H1)", () => {
  const owner = nacl.sign.keyPair();
  const ownerAddr = bs58.encode(owner.publicKey);
  const payout = bs58.encode(nacl.sign.keyPair().publicKey);

  it("accepts the owner's signature over their own payout", () => {
    expect(verifyPayoutAttestation(ownerAddr, payout, sign(owner, payout))).toBe(true);
  });

  it("rejects a swapped payout (the essence of the H1 attack)", () => {
    const attacker = bs58.encode(nacl.sign.keyPair().publicKey);
    expect(verifyPayoutAttestation(ownerAddr, attacker, sign(owner, payout))).toBe(false);
  });

  it("rejects a signature by a foreign key (the server cannot sign for the owner)", () => {
    const evil = nacl.sign.keyPair();
    expect(verifyPayoutAttestation(ownerAddr, payout, sign(evil, payout))).toBe(false);
  });

  it("rejects garbage instead of a signature/address (fail-closed, no throws)", () => {
    expect(verifyPayoutAttestation(ownerAddr, payout, "not-base64!!")).toBe(false);
    expect(verifyPayoutAttestation(ownerAddr, payout, "")).toBe(false);
    expect(verifyPayoutAttestation("not-an-address", payout, sign(owner, payout))).toBe(false);
  });
});
