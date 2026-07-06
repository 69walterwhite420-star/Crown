import { decode, encode } from "@/lib/data/codec";
import { DataError } from "@/lib/data/provider";
import type { Address } from "@/lib/data/types";
import { issueNonce, resolveToken, revokeToken, verifyAndIssueToken } from "@/server/auth";
import { ingestActivation, ingestSignature } from "@/server/ingest";
import { runWithIdentity } from "@/server/request-context";
import { CHAIN_MODE, IS_PROD } from "@/server/runtime";
import { getStore, persistStore } from "@/server/store";

export const dynamic = "force-dynamic";

// C1/M2: IS_PROD and the server-side CHAIN_MODE live in @/server/runtime (one formula for gating and crediting).
// CHAIN_MODE → off-chain Crown simulation is forbidden: otherwise any wallet signed in via SIWS could conjure up
// a Crown + Reign + overlay bypassing the chain (a violation of §4.4/§4.7). Only ingestSignature grants Reign.
// activateChannel likewise: an off-chain flip to ACTIVE bypassing the collection → only ingest of the on-chain collection (ingestActivation).
const CHAIN_FORBIDDEN = new Set<string>(["createDonation", "activateChannel"]);

// Methods that change store state → after them we schedule a save to disk (ADR 0013). Read methods
// do not write (needless writes serve no purpose). ingest*/__reset are handled by separate branches and save there.
const MUTATING = new Set<string>([
  "createChannel",
  "activateChannel",
  "attestPayout",
  "updateChannelConfig",
  "createDonation",
  "updateProfile",
  "setMessageState",
  "hideDonorMessages",
  "reportMessage",
  "addChannelBlock",
  "removeChannelBlock",
  "applyOperatorAction",
  "gameAction", // mini-game mutations (game-bus, ADR 0016)
]);

// Whitelist of allowed store methods (DataProvider methods). Authorization of each mutation is done by the
// store itself based on the verified identity; here it is transport only. Dev methods (__reset) and auth methods (__auth*)
// are NOT included here — they are handled by explicit branches below.
const ALLOWED = new Set<string>([
  "getSession",
  "connect",
  "disconnect",
  "getProfile",
  "updateProfile",
  "listChannels",
  "getChannel",
  "getMyChannel",
  "getManagedChannels",
  "getOperatorChannels",
  "getChannelConfig",
  "createChannel",
  "activateChannel",
  "attestPayout",
  "updateChannelConfig",
  "hideDonorMessages",
  "getStanding",
  "getLeaderboard",
  "getDonorOverview",
  "homeFeed",
  "createDonation",
  "precheckText",
  "listDonations",
  "getModerationQueue",
  "setMessageState",
  "reportMessage",
  "getChannelBlocklist",
  "getMyChannelBlock",
  "addChannelBlock",
  "removeChannelBlock",
  "getOperatorQueue",
  "applyOperatorAction",
  "gameAction", // mini-games (game-bus, ADR 0016)
  "gameQuery",
]);

interface RpcBody {
  method: string;
  args: unknown[];
  token?: string | null; // session token (issued after verifying the SIWS signature) — the verified identity
  address?: Address | null; // DEV login by address without a signature; IGNORED in prod
  failMode?: boolean;
}

function json(payload: unknown, status = 200): Response {
  return new Response(encode(payload), { status, headers: { "content-type": "application/json" } });
}
function rpcError(code: string, message: string, status = 200): Response {
  return json({ ok: false, error: { code, message } }, status);
}
// R4 (ADR 0012): we return the error text to the client ONLY for domain DataError (they are written for the user).
// Others (web3.js/PublicKey/RPC failure/bug) → a generic text, with details in the server log so they don't leak.
function caughtError(e: unknown, fallbackCode = "ERROR"): Response {
  if (e instanceof DataError)
    return json({ ok: false, error: { code: e.code, message: e.message } });
  console.error("[rpc] unhandled error:", e);
  return json({ ok: false, error: { code: fallbackCode, message: "Internal server error." } });
}

export async function POST(req: Request): Promise<Response> {
  let body: RpcBody;
  try {
    body = decode<RpcBody>(await req.text());
  } catch {
    return rpcError("BAD_BODY", "Invalid request body", 400);
  }
  if (typeof body?.method !== "string") return rpcError("BAD_BODY", "method is required", 400);
  // We normalize args here: a non-array (object/string/number) is caught before dispatch, otherwise fn.apply would throw
  // a raw TypeError that leaks to the client (R3, ADR 0012). undefined → an empty argument list.
  if (body.args === undefined || body.args === null) body.args = [];
  if (!Array.isArray(body.args)) return rpcError("BAD_ARGS", "args must be an array", 400);

  // — Authentication (public methods: they establish the identity, they do not require it) —
  if (body.method === "__authNonce") {
    const address = body.args?.[0];
    if (typeof address !== "string") return rpcError("BAD_ARGS", "address is required", 400);
    const res = issueNonce(address);
    if (!res) return rpcError("AUTH_BAD_ADDRESS", "Invalid Solana address.");
    return json({ ok: true, result: res });
  }
  if (body.method === "__authVerify") {
    const [address, signatureB64] = body.args ?? [];
    if (typeof address !== "string" || typeof signatureB64 !== "string") {
      return rpcError("BAD_ARGS", "address and signature are required", 400);
    }
    const res = verifyAndIssueToken(address, signatureB64);
    if (!res) return rpcError("AUTH_FAILED", "The signature failed verification (or the nonce expired).");
    return json({ ok: true, result: res });
  }

  const store = await getStore();
  store.__setLatencyScale(0);
  store.__setFailMode(!IS_PROD && Boolean(body.failMode)); // L1: error injection — dev tooling only, never from prod

  // The request identity comes ONLY from a verified token. Login by a bare address without a signature is allowed
  // only as dev tooling for mock/api and ONLY when it is safe: not prod AND not a money chain mode.
  // Otherwise (prod, or staging in chain mode without NODE_ENV=production) `address` is ignored — otherwise
  // anyone could impersonate an owner/operator while money is live (an extension of the C1 protection, ADR 0012).
  // The identity is NOT stored in a field of the singleton store — it is carried per-request via AsyncLocalStorage
  // (runWithIdentity around the dispatch below), otherwise concurrent RPCs would overwrite each other's session.
  const allowDevIdentity = !IS_PROD && !CHAIN_MODE;
  const verified = resolveToken(body.token);
  const identity = verified ?? (allowDevIdentity ? (body.address ?? null) : null);

  // Dev store reset — only outside prod and never from the normal dispatch.
  if (body.method === "__reset") {
    if (IS_PROD) return rpcError("BAD_METHOD", "Method unavailable.", 403);
    store.__reset();
    persistStore();
    return json({ ok: true, result: null });
  }

  // Special method: accepting an on-chain Crown by signature (the server validates it from the chain, see server/ingest.ts).
  if (body.method === "ingestSignature") {
    const sig = body.args?.[0];
    const text = body.args?.[1];
    if (typeof sig !== "string") return rpcError("BAD_ARGS", "signature is required", 400);
    try {
      const result = await ingestSignature(store, sig, typeof text === "string" ? text : undefined);
      if (result.ok) persistStore(); // Crown written to the store → to disk
      return json({ ok: true, result });
    } catch (e) {
      // A malformed/unknown signature or an RPC failure would otherwise crash the public endpoint into a 500 (details go to the log).
      return caughtError(e, "INGEST_ERROR");
    }
  }

  // Special method: accepting an on-chain activation collection by signature (the server validates it from the chain, see server/ingest.ts).
  if (body.method === "ingestActivation") {
    const sig = body.args?.[0];
    if (typeof sig !== "string") return rpcError("BAD_ARGS", "signature is required", 400);
    try {
      const result = await ingestActivation(store, sig);
      if (result.ok) persistStore(); // realm activated → to disk
      return json({ ok: true, result });
    } catch (e) {
      return caughtError(e, "INGEST_ERROR");
    }
  }

  // C1: off-chain Crown simulation is unavailable in chain mode — only ingestSignature grants Reign.
  if (CHAIN_MODE && CHAIN_FORBIDDEN.has(body.method)) {
    return rpcError(
      "CHAIN_MODE",
      "Off-chain Crown simulation is disabled: in chain mode a Crown goes on-chain (ingestSignature).",
      403,
    );
  }

  if (!ALLOWED.has(body.method)) {
    return rpcError("BAD_METHOD", `Method not allowed: ${body.method}`, 400);
  }

  // Explicit logout — we tear down the server session (token).
  if (body.method === "disconnect") revokeToken(body.token);

  const fn = (store as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined>)[
    body.method
  ];
  if (typeof fn !== "function") {
    return rpcError("BAD_METHOD", `Method not found: ${body.method}`, 400);
  }

  try {
    // H3: dispatch runs in the context of the per-request identity (AsyncLocalStorage), not from a singleton field —
    // concurrent RPCs do not overwrite each other's session, including during real awaits (Postgres).
    const result = await runWithIdentity(identity, () => fn.apply(store, body.args));
    if (MUTATING.has(body.method)) persistStore(); // mutation succeeded → schedule a save to disk
    return json({ ok: true, result });
  } catch (e) {
    return caughtError(e);
  }
}
