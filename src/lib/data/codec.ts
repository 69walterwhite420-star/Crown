/**
 * JSON codec with bigint support (money — micro-USDC is stored as bigint, and JSON can't handle it).
 * Used by BOTH sides of the RPC bridge (route + ApiDataProvider) so that amounts survive transport.
 */

interface BigintTag {
  __bigint: string;
}

// L2 (audit): we constrain length/format — a giant string in __bigint → expensive BigInt arithmetic (DoS
// of a public endpoint). Money in micro-USDC fits with a huge margin (<= 40 digits). A non-conforming tag
// passes through as an ordinary object (not converted), without throwing.
const BIGINT_RE = /^-?\d{1,40}$/;
function isBigintTag(v: unknown): v is BigintTag {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as BigintTag).__bigint === "string" &&
    BIGINT_RE.test((v as BigintTag).__bigint)
  );
}

/** Serialization: bigint → { __bigint: "<dec>" }. Symmetric with decode: whatever decode won't revive (> 40 digits)
 *  we also don't encode — otherwise the value would silently come back as an object, not a bigint. Unreachable for money. */
export function encode(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v !== "bigint") return v;
    const s = v.toString();
    if (!BIGINT_RE.test(s)) throw new Error("bigint out of codec range (> 40 digits)");
    return { __bigint: s } satisfies BigintTag;
  });
}

/** Deserialization: { __bigint } → bigint. */
export function decode<T = unknown>(text: string): T {
  return JSON.parse(text, (_k, v) => (isBigintTag(v) ? BigInt(v.__bigint) : v)) as T;
}
