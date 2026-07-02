import bs58 from "bs58";
import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import { buildPayoutAttestationMessage, verifyPayoutAttestation } from "./attestation";

/** Подпись сообщения реальным ed25519-ключом — то, что делает кошелёк владельца (signMessage). */
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

  it("принимает подпись владельца над своим payout", () => {
    expect(verifyPayoutAttestation(ownerAddr, payout, sign(owner, payout))).toBe(true);
  });

  it("отклоняет подменённый payout (суть атаки H1)", () => {
    const attacker = bs58.encode(nacl.sign.keyPair().publicKey);
    expect(verifyPayoutAttestation(ownerAddr, attacker, sign(owner, payout))).toBe(false);
  });

  it("отклоняет подпись чужим ключом (сервер не может подписать за владельца)", () => {
    const evil = nacl.sign.keyPair();
    expect(verifyPayoutAttestation(ownerAddr, payout, sign(evil, payout))).toBe(false);
  });

  it("отклоняет мусор вместо подписи/адреса (fail-closed, без бросков)", () => {
    expect(verifyPayoutAttestation(ownerAddr, payout, "not-base64!!")).toBe(false);
    expect(verifyPayoutAttestation(ownerAddr, payout, "")).toBe(false);
    expect(verifyPayoutAttestation("не-адрес", payout, sign(owner, payout))).toBe(false);
  });
});
