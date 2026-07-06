import { describe, expect, it } from "vitest";
import { demoAddress } from "./dev-identity";

/** demoAddress is a dev-only impersonation helper: it must be deterministic and address-shaped. */
describe("dev-identity: demoAddress", () => {
  it("is deterministic for a given label", () => {
    expect(demoAddress("max")).toBe(demoAddress("max"));
  });

  it("maps distinct labels to distinct addresses", () => {
    expect(demoAddress("max")).not.toBe(demoAddress("lena"));
  });

  it("produces a 44-char base58 string (no 0/O/I/l)", () => {
    const a = demoAddress("whalemoon");
    expect(a).toHaveLength(44);
    expect(a).toMatch(/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/);
  });
});
