import { createPublicKey, randomBytes, verify as edVerify } from "crypto";
import { PublicKey } from "@solana/web3.js";
import { buildSiwsMessage, type SiwsFields } from "@/lib/chain/siws";
import { makeSaver, readSnapshot } from "@/server/persist";

/**
 * Server-side authentication (closes the hole: identity used to be the UNVERIFIED `address` from the request body).
 *
 * SIWS flow:
 *   1. `issueNonce(address)` — the server issues a one-time nonce with a TTL and a canonical message.
 *   2. the client signs the message with their wallet (signMessage) and sends the signature.
 *   3. `verifyAndIssueToken(address, sigB64)` — the server verifies the ed25519 signature over the same message,
 *      burns the nonce (one-time), and issues a session token.
 *   4. subsequent RPCs carry the token; `resolveToken(token)` → verified address (or null).
 *
 * Signature verification uses no new dependencies: built-in node:crypto (ed25519) over the raw 32-byte
 * Solana pubkey (wrapped in SPKI DER). The in-memory nonce/session stores are a stand-in for Postgres/Redis,
 * like the store itself; in production they move to a shared persistence layer.
 */

const NONCE_TTL_MS = 5 * 60_000; // 5 minutes to sign
const SESSION_TTL_MS = 12 * 60 * 60_000; // 12 hours
// M1 (audit): the domain in the SIWS message — the user sees where they're signing in, and the signature doesn't carry across apps.
const SIWS_DOMAIN = process.env.APP_DOMAIN ?? "standing.local";
// M1: hard caps on the in-memory stores — `__authNonce` is unauthenticated, otherwise memory growth is unbounded.
// B5: `prune` clears EXPIRED entries first, so an honest nonce is evicted (FIFO) only when > MAX_NONCES are LIVE
// at once — which requires a sustained spray across many addresses. We keep headroom (records are tiny); the REAL
// protection of the unauthenticated endpoint against flooding is a rate limit at the edge (Cloudflare/nginx), not in app code.
const MAX_NONCES = 50_000;
const MAX_SESSIONS = 50_000;

interface NonceRec {
  nonce: string;
  exp: number;
  issuedAt: number;
}
interface SessionRec {
  address: string;
  exp: number;
}

const g = globalThis as unknown as {
  __standingNonces?: Map<string, NonceRec>;
  __standingSessions?: Map<string, SessionRec>;
  __authLoaded?: boolean;
  __authSave?: () => void;
};
const nonces = (g.__standingNonces ??= new Map());
const sessions = (g.__standingSessions ??= new Map());

// Session persistence (ADR 0013): SIWS sessions survive a server restart → no need to re-sign
// after every restart. We do NOT persist nonces (they live 5 min, transient). We load once per process,
// discarding expired ones. The saver lives on globalThis so it survives HMR.
if (!g.__authLoaded) {
  g.__authLoaded = true;
  const persisted = readSnapshot<[string, SessionRec][]>("auth.json");
  if (persisted)
    for (const [token, rec] of persisted) if (rec.exp > Date.now()) sessions.set(token, rec);
}
const saveSessions = (g.__authSave ??= makeSaver("auth.json", () => [...sessions.entries()]));

/** Clear expired + cap the size (evict oldest by insertion order) — memory anti-DoS. */
function prune<T extends { exp: number }>(map: Map<string, T>, max: number): void {
  const now = Date.now();
  for (const [k, v] of map) if (v.exp < now) map.delete(k);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

/** SIWS fields from the nonce timestamps — identical at issue and verify → the message matches byte for byte. */
function siwsFields(issuedAt: number, exp: number): SiwsFields {
  return {
    domain: SIWS_DOMAIN,
    issuedAt: new Date(issuedAt).toISOString(),
    expiresAt: new Date(exp).toISOString(),
  };
}

/** Whether this is a valid base58 Solana address on the ed25519 curve (an authoritative check, unlike a format check). */
function isValidAddress(address: string): boolean {
  try {
    // PublicKey throws on malformed base58; isOnCurve rejects PDAs/garbage (an incoming wallet's key is on the curve).
    return PublicKey.isOnCurve(new PublicKey(address).toBytes());
  } catch {
    return false;
  }
}

/** Step 1: issue a nonce + the message to sign. */
export function issueNonce(address: string): { nonce: string; message: string } | null {
  if (!isValidAddress(address)) return null;
  prune(nonces, MAX_NONCES);
  const nonce = randomBytes(24).toString("hex");
  const issuedAt = Date.now();
  const exp = issuedAt + NONCE_TTL_MS;
  nonces.set(address, { nonce, exp, issuedAt });
  return { nonce, message: buildSiwsMessage(address, nonce, siwsFields(issuedAt, exp)) };
}

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** ed25519 verification of a message signature with a raw 32-byte pubkey (Solana address). */
function verifySignature(address: string, message: string, signatureB64: string): boolean {
  try {
    const raw = Buffer.from(new PublicKey(address).toBytes()); // 32 bytes
    const keyObj = createPublicKey({
      key: Buffer.concat([SPKI_ED25519_PREFIX, raw]),
      format: "der",
      type: "spki",
    });
    const sig = Buffer.from(signatureB64, "base64");
    if (sig.length !== 64) return false;
    return edVerify(null, Buffer.from(message, "utf8"), keyObj, sig);
  } catch {
    return false;
  }
}

/** Step 3: verify the signature against the issued nonce, burn the nonce, issue a session token. */
export function verifyAndIssueToken(
  address: string,
  signatureB64: string,
): { token: string; exp: number } | null {
  const rec = nonces.get(address);
  if (!rec || rec.exp < Date.now()) {
    nonces.delete(address);
    return null;
  }
  nonces.delete(address); // one-time: the nonce is burned in every outcome (no reuse/brute-forcing)
  const message = buildSiwsMessage(address, rec.nonce, siwsFields(rec.issuedAt, rec.exp));
  if (!verifySignature(address, message, signatureB64)) return null;

  prune(sessions, MAX_SESSIONS);
  const token = randomBytes(32).toString("hex");
  const exp = Date.now() + SESSION_TTL_MS;
  sessions.set(token, { address, exp });
  saveSessions(); // the session survives a restart (ADR 0013)
  return { token, exp };
}

/** Step 4: token → verified address (or null if missing/expired). */
export function resolveToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const rec = sessions.get(token);
  if (!rec) return null;
  if (rec.exp < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return rec.address;
}

/** Explicit sign-out — invalidate the token. */
export function revokeToken(token: string | null | undefined): void {
  if (token) {
    sessions.delete(token);
    saveSessions();
  }
}
