import { MockDataProvider, type StoreSnapshot } from "@/lib/data/mock-provider";
import { readEscrowOutcome, readEscrowState, verifyEscrowOnChain } from "@/server/escrow-verify";
import { scanEscrowClaimsNow, startIndexer } from "@/server/indexer-service";
import { readSnapshot } from "@/server/persist";
import { currentIdentity } from "@/server/request-context";
import { CHAIN_MODE } from "@/server/runtime";
import { loadStore, saveStore } from "@/server/store-db";

/**
 * Server-side storage. The source of truth is the event log; Reign is computed by the same SHARED engine
 * (lib/reputation.ts) as in the mock → the numbers match (invariant §4.4, ADR 0001).
 *
 * Persistence (Phase 4): state lives in real Postgres tables (PGlite, src/server/db.ts +
 * store-db.ts). At startup we load from the DB; if the DB is still empty, we do a one-time migration of the
 * previous JSON snapshot (.data/store.json). After mutations we write back to the tables. The store logic works
 * on an in-memory copy; direct SQL reads without a copy are an optimization for later.
 *
 * The singleton (as a Promise) and its saver are cached on globalThis: they survive HMR in dev and are shared across requests.
 */
const STORE_FILE = "store.json";
const g = globalThis as unknown as {
  __standingStorePromise?: Promise<MockDataProvider>;
  __standingSave?: () => void;
};

export function getStore(): Promise<MockDataProvider> {
  if (!g.__standingStorePromise) g.__standingStorePromise = init();
  return g.__standingStorePromise;
}

async function init(): Promise<MockDataProvider> {
  const store = new MockDataProvider();
  // H3: the request identity comes from per-request AsyncLocalStorage (request-context), not from a mutable field.
  store.__setIdentityResolver(() => currentIdentity() ?? null);
  // H1: in chain mode a payout is accepted only with the owner's ed25519 signature (fail-closed) — the server
  // stops being the source of truth for the payout address (the donor client verifies the signature itself).
  store.requirePayoutAttestation = CHAIN_MODE;
  // Server-side escrow verification hooks (ADR 0017/ESC-12): we inject them ONLY here (store.ts is a server module) so that
  // `@/server/escrow-verify` → store-db → PGlite/node:path don't get dragged into the mock provider's client bundle.
  store.verifyEscrowHook = (id, expect) => verifyEscrowOnChain(id, expect);
  // Escrow outcome with race self-healing: a claim just went on-chain (the escrow is closed), but the background indexer
  // hasn't recorded the outcome yet → readEscrowOutcome would return null and the off-chain claim would fail with NOT_RESOLVED, even though
  // the money has already returned to the donor (the "Claim → task not resolved" incident). On a miss we rescan the claim-tx
  // now (the cursor is shared, idempotent) and re-read. A scan failure (429/RPC) doesn't break the claim — we return the previous null.
  store.escrowOutcomeHook = async (id) => {
    const outcome = await readEscrowOutcome(id);
    if (outcome !== null) return outcome;
    try {
      await scanEscrowClaimsNow();
    } catch {
      return null;
    }
    return readEscrowOutcome(id);
  };
  // ESC-19: raw on-chain state — the indexer uses it to reveal the task text on an on-chain `accept`.
  store.escrowStateHook = (id) => readEscrowState(id);

  const snap = await loadStore();
  if (snap) {
    store.__restore(snap);
  } else {
    // One-time migration: Postgres is empty → we move the existing JSON snapshot into the DB.
    const file = readSnapshot<StoreSnapshot>(STORE_FILE);
    if (file) store.__restore(file);
    await saveStore(store.__snapshot());
  }

  g.__standingSave = makeSaver(store);
  startIndexer(store, persistStore); // background intake of on-chain Crowns (chain mode only)
  return store;
}

/** Schedule saving the store to Postgres. Called by the route handler after mutations. */
export function persistStore(): void {
  g.__standingSave?.();
}

/**
 * Saving after mutations: coalesces bursts and does NOT allow two saves in parallel (saveStore
 * rewrites the tables entirely — a parallel run could overlap). We log the error, without crashing the request.
 */
function makeSaver(store: MockDataProvider): () => void {
  let saving = false;
  let pending = false;
  const run = async () => {
    saving = true;
    while (pending) {
      pending = false;
      try {
        await saveStore(store.__snapshot());
      } catch (e) {
        console.error("[pg-persist] failed to save store:", e);
      }
    }
    saving = false;
  };
  return () => {
    pending = true;
    if (!saving) void run();
  };
}
