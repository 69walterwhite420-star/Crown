import { encode } from "@/lib/data/codec";
import { anchorStatus, computeAnchorBundle } from "@/server/anchor";
import { getStore } from "@/server/store";

export const dynamic = "force-dynamic";

/**
 * Public preimage of the proof anchor: the full Reign ledger and all config versions (public data) +
 * PER-RECORD HASHES of the operator log (incident log + operator actions — their contents are private, §4.6,
 * and never leave the server) + the current digests and the last published anchor. A third party recomputes
 * the digests from this export and compares them against the on-chain memo (scripts/verify-export.ts) — any
 * silent rewrite of the past gets caught.
 */
export async function GET(): Promise<Response> {
  const store = await getStore();
  const { ledger, configs } = store.exportAnchorData();
  const bundle = await computeAnchorBundle(store);
  return new Response(
    encode({
      format: "standing-anchor-export/1",
      generatedAt: new Date().toISOString(),
      digests: bundle.digests,
      ledgerCount: bundle.ledgerCount,
      lastAnchor: await anchorStatus(),
      ledger,
      configs,
      incidentHashes: bundle.incidentHashes,
      actionHashes: bundle.actionHashes,
    }),
    { headers: { "content-type": "application/json" } },
  );
}
