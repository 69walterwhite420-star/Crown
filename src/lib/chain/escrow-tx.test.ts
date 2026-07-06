import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import { decodeEscrowClaims } from "./escrow-tx";

/**
 * M3 — decoder of on-chain claim outcomes from tx instructions (the money truth, survives the escrow's close).
 * The discriminators must match DISC in escrow-tx.ts (sha256("global:<fn>")[..8]).
 */
const PROG = new PublicKey("GPP2BCNMp8peLh3uySuEqPb2gWanr4xw5Lf3X7Kx7GU4");
const CLAIM_STREAMER = [126, 138, 229, 228, 43, 41, 147, 179];
const CLAIM_DONOR = [50, 4, 6, 190, 27, 110, 39, 211];
const key = () => Keypair.generate().publicKey;
const data = (disc: number[]) => bs58.encode(Buffer.from(disc));

describe("decodeEscrowClaims (M3)", () => {
  it("claim_streamer → to_streamer; escrow = accounts[2]", () => {
    const escrow = key();
    const ixs = [{ programId: PROG, accounts: [key(), key(), escrow, key()], data: data(CLAIM_STREAMER) }];
    expect(decodeEscrowClaims(PROG, ixs)).toEqual([{ escrow: escrow.toBase58(), outcome: "to_streamer" }]);
  });

  it("claim_donor → to_donor; escrow = accounts[1]", () => {
    const escrow = key();
    const ixs = [{ programId: PROG, accounts: [key(), escrow, key()], data: data(CLAIM_DONOR) }];
    expect(decodeEscrowClaims(PROG, ixs)).toEqual([{ escrow: escrow.toBase58(), outcome: "to_donor" }]);
  });

  it("in a combined tx (resolve_timeout + claim) it's the claim that's taken", () => {
    const escrow = key();
    const ixs = [
      { programId: PROG, accounts: [key(), escrow], data: data([149, 55, 89, 144, 121, 143, 48, 210]) }, // resolve_timeout
      { programId: PROG, accounts: [key(), key(), escrow, key()], data: data(CLAIM_STREAMER) },
    ];
    expect(decodeEscrowClaims(PROG, ixs)).toEqual([{ escrow: escrow.toBase58(), outcome: "to_streamer" }]);
  });

  it("foreign program / non-claim / corrupt data → empty", () => {
    expect(
      decodeEscrowClaims(PROG, [
        { programId: key(), accounts: [key(), key(), key()], data: data(CLAIM_STREAMER) }, // foreign program
        { programId: PROG, accounts: [key(), key(), key()], data: data([1, 2, 3, 4, 5, 6, 7, 8]) }, // not a claim
        { programId: PROG, accounts: [key(), key(), key()], data: "" }, // empty data
      ]),
    ).toEqual([]);
  });
});
