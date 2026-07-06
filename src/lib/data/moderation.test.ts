import { describe, expect, it } from "vitest";
import { classifyTaskText, hashContent } from "./moderation";

/**
 * Test of TASK TEXT moderation (escrow-task). The keyword-backstop wordlist was REMOVED (it produced false blocks
 * on legal in-game "steal/swipe/rob …"). Task legality is judged by the semantic AI (OpenAI),
 * which is NOT run here — the test environment has no OPENAI_API_KEY. So offline we only check the
 * deterministic contract: the unconditional CSAM block and the absence of false blocks without a key.
 */
describe("classifyTaskText — offline (no OpenAI key)", () => {
  it("explicit CSAM marker → HARD_BLOCK (unconditionally, the game context is no excuse)", async () => {
    for (const t of ["child porn", "childporn", "csam", "pedophile"]) {
      expect(await classifyTaskText(t)).toBe("HARD_BLOCK");
    }
  });

  it("without a key there is no smart judge → non-CSAM returns CLEAR (no false blocks)", async () => {
    // In-game phrasings that the former wordlist falsely blocked — now they pass.
    for (const t of ["steal the flag from the enemies", "swipe the base in dota", "rob the enemy camp"]) {
      expect(await classifyTaskText(t)).toBe("CLEAR");
    }
    // Ordinary harmless tasks — also CLEAR.
    for (const t of ["dance a jig", "do 50 push-ups", "sing a song", "show your setup"]) {
      expect(await classifyTaskText(t)).toBe("CLEAR");
    }
  });
});

describe("hashContent — cryptographically strong SHA-256 (onchain text anchor + moderation key)", () => {
  it("matches the reference SHA-256 of the normalized text", async () => {
    // Known vector: sha256("abc"). It used to be FNV-1a 32 bits (8 hex) → an instant second preimage:
    // substituting text under someone else's memo.m and colliding with a cached CLEAR. Now full SHA-256.
    expect(await hashContent("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
  it("normalizes case/whitespace (trim + lowercase + collapse)", async () => {
    expect(await hashContent("  Hello   World  ")).toBe(await hashContent("hello world"));
  });
  it("64 hex; different texts → different hashes", async () => {
    const h = await hashContent("hello");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashContent("hello!")).not.toBe(h);
  });
});
