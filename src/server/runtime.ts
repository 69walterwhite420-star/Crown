/**
 * Server runtime flags (NOT NEXT_PUBLIC — unavailable to the client, unspoofable from the browser). Single source
 * of truth for the C1 gate (route) and the M2 finalized-based crediting (ingest), so the chain-mode formula isn't duplicated.
 */
import { IS_PROD } from "@/lib/chain/addresses"; // single source of the prod gate (no duplicated formula)

export { IS_PROD };

// Explicit server chain mode. Fail-safe: in production it's on BY DEFAULT unless CHAIN_MODE=off is set.
// on → off-chain Crown simulation is forbidden (C1) and crediting waits for finalized, not confirmed (M2, reorg protection).
export const CHAIN_MODE =
  process.env.CHAIN_MODE === "on" || (IS_PROD && process.env.CHAIN_MODE !== "off");
