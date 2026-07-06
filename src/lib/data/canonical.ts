/**
 * Canonical serialization + SHA-256 for proof-anchor digests and independent export verification.
 *
 * The requirement is DETERMINISM across processes and restarts: the same set of data must produce a
 * byte-for-byte identical string on the server (which publishes the anchor) and at a third party (which
 * recomputes it from the export). Plain JSON.stringify depends on key insertion order (an in-memory object
 * vs. an object restored from Postgres may differ) — so keys are sorted recursively.
 *
 * Do NOT use hashContent from moderation.ts: it normalizes text (lowercase/trim) — for digests that would
 * collapse different base58 addresses that differ only in case.
 */

/** JSON with recursively sorted keys; bigint → a tagged string (codec symmetry isn't needed — the
 *  string is used only as hash input and is never parsed back). undefined in objects is omitted
 *  (as in JSON.stringify) so that "no field" and "field = undefined" produce the same digest. */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "bigint") return `"__bigint:${(value as bigint).toString()}"`;
  if (t === "number" || t === "boolean") return JSON.stringify(value);
  if (t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (t === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error(`stableStringify: non-serializable type ${t}`);
}

/** SHA-256 hex WITHOUT input normalization. Web Crypto — the same in the browser, node, and vitest. */
export async function sha256Hex(s: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
