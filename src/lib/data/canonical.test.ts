import { describe, expect, it } from "vitest";
import { sha256Hex, stableStringify } from "./canonical";

describe("stableStringify (determinism of anchor digests)", () => {
  it("does not depend on key order (in-memory vs. restored from the DB)", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("bigint serializes stably (money in micro-USDC)", () => {
    expect(stableStringify({ amount: 5_000_000n })).toBe('{"amount":"__bigint:5000000"}');
  });

  it("a missing field and a field = undefined produce the same digest", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });

  it("arrays preserve order (the journal is append-only, order matters)", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
});

describe("sha256Hex", () => {
  it("known SHA-256 vector, WITHOUT case normalization (base58 addresses are case-sensitive)", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await sha256Hex("ABC")).not.toBe(await sha256Hex("abc"));
  });
});
