import bs58 from "bs58";
import nacl from "tweetnacl";

/**
 * Attestation of a realm's payout address (closes H1: "payout dictated by the server").
 *
 * The realm owner signs, ONCE with their wallet, a canonical message "crowns to my realm go to
 * address X". From then on the server stops being the source of truth for the payout address: the donor's
 * client verifies the signature BEFORE building the transaction (chain-provider), the server — on credit (ingest).
 * Swapping the payout in the DB/on the server without the owner's key yields an invalid signature → the crown is
 * neither built nor credited (fail-closed).
 *
 * Residual trust (documented in trust-layers.md): the handle → ownerAddress binding stays platform-controlled.
 * The attestation guarantees the money goes where the owner's KEY said, not the server.
 *
 * Isomorphic module (bs58 + tweetnacl, no web3.js/node): browser (chain-provider, donor), server
 * (mock-provider on createChannel/attestPayout, ingest), and the independent verification script (verify-export).
 */

/** Canonical message to sign. Any change to the string breaks existing signatures — change it via v. */
export function buildPayoutAttestationMessage(owner: string, payout: string): string {
  return [
    "Standing: confirmation of the realm's payout address.",
    "",
    "By signing, you declare: crowns to your realm must go to this address.",
    "This is not a transaction: no money moves and no gas is spent.",
    "",
    `owner: ${owner}`,
    `payout: ${payout}`,
    "v: 1",
  ].join("\n");
}

/** base64 → bytes without a Buffer dependency (browser); on the server Buffer is faster and always present. */
function fromBase64(s: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64"));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** ed25519 verification of the owner's signature over the canonical message. Any parse failure → false (fail-closed). */
export function verifyPayoutAttestation(
  owner: string,
  payout: string,
  signatureB64: string,
): boolean {
  try {
    const pub = bs58.decode(owner);
    if (pub.length !== 32) return false;
    const sig = fromBase64(signatureB64);
    if (sig.length !== 64) return false;
    const msg = new TextEncoder().encode(buildPayoutAttestationMessage(owner, payout));
    return nacl.sign.detached.verify(msg, sig, pub);
  } catch {
    return false;
  }
}
