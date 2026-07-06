import { getAssociatedTokenAddress } from "@solana/spl-token";
import { Connection, type PartiallyDecodedInstruction, PublicKey } from "@solana/web3.js";
import { ESCROW_PROGRAM_ID } from "@/lib/chain/addresses";
import { DEVNET_RPC, mintPubkey, treasuryPubkey } from "@/lib/chain/config";
import { decodeEscrowClaims } from "@/lib/chain/escrow-tx";
import { fetchNewProgramSignatures, fetchNewTreasurySignatures } from "@/lib/chain/indexer";
import { DataError } from "@/lib/data/provider";
import type { MockDataProvider } from "@/lib/data/mock-provider";
import { maybeAnchor } from "@/server/anchor";
import { ESCROW_OUTCOME_META_PREFIX } from "@/server/escrow-verify";
import { ingestActivation, ingestSignature } from "@/server/ingest";
import { getMeta, setMeta } from "@/server/store-db";

/**
 * Background indexer (Phase 4 / reliability). It watches the chain itself and catches up on on-chain Crowns INDEPENDENTLY of
 * the supporter's browser: even if the client closed before ingest, the Crown (money + points) is not lost. All Crowns and
 * activation fees pay a commission into the treasury, so it is enough to watch ONE address — the treasury-ATA.
 *
 * RPC is taken from DEVNET_RPC (env NEXT_PUBLIC_DEVNET_RPC; a free public one by default) — switching to a
 * provider (Helius/QuickNode) = changing this variable, no code changes. The cursor (last processed
 * signature) is stored in meta → polling does not start from scratch after a restart. Works only in chain mode.
 *
 * Started from store.ts once per process. IMPORTANT: this is a long-lived loop — fine for a standalone/local
 * Node server; in serverless prod the indexer is moved into a separate worker/cron (the same ingestSignature).
 */
const POLL_MS = 20_000;
const CURSOR_KEY = "indexerCursor";
const ESCROW_CURSOR_KEY = "escrowIndexerCursor";

/**
 * M3 — event indexer of the escrow program. Scans the program's signatures and records the on-chain outcome of `claim`s
 * (`claim_streamer` → to_streamer, `claim_donor` → to_donor) in meta by escrow PDA. This is the MONEY TRUTH, which
 * outlives the account's closure (claim closes the escrow in the same tx) — the settler reads it via readEscrowOutcome
 * and banks Reign strictly for money that actually moved (closing the tail of ESC-12/16: "Reign ≠ money").
 * Returns true if it wrote anything.
 */
async function scanEscrowClaims(connection: Connection, programId: PublicKey): Promise<boolean> {
  const cursor = (await getMeta(ESCROW_CURSOR_KEY)) ?? undefined;
  const sigs = await fetchNewProgramSignatures(connection, programId, cursor);
  let wrote = false;
  for (const sig of sigs) {
    const tx = await connection.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0 });
    // B3: tx not returned yet (transient RPC / hasn't reached confirmed) → do NOT move the cursor, retry on
    // the next poll. Otherwise the claim outcome would be skipped forever → Reign for the escrow would not be credited.
    if (!tx) break;
    const ixs = tx.transaction.message.instructions
      .filter((ix): ix is PartiallyDecodedInstruction => "data" in ix && "accounts" in ix)
      .map((ix) => ({ programId: ix.programId, accounts: ix.accounts, data: ix.data }));
    for (const { escrow, outcome } of decodeEscrowClaims(programId, ixs)) {
      await setMeta(ESCROW_OUTCOME_META_PREFIX + escrow, outcome);
      wrote = true;
    }
    await setMeta(ESCROW_CURSOR_KEY, sig); // processed → move the cursor (claim / other program tx)
    await new Promise((r) => setTimeout(r, 200)); // spare the free RPC
  }
  return wrote;
}

/**
 * M3 on-demand: scan claim outcomes RIGHT NOW (outside the background poll). Needed on the hot claim path:
 * the chain provider just did resolve_timeout+claim on-chain (escrow closed), but the background indexer hasn't yet
 * recorded the outcome → otherwise off-chain settle defers and the claim fails with NOT_RESOLVED, even though the money already came back.
 * The cursor is shared with the background loop (idempotent). Silently returns false if the escrow program is not configured.
 */
export async function scanEscrowClaimsNow(): Promise<boolean> {
  if (!ESCROW_PROGRAM_ID) return false;
  const connection = new Connection(DEVNET_RPC, "confirmed");
  return scanEscrowClaims(connection, new PublicKey(ESCROW_PROGRAM_ID));
}

export function startIndexer(store: MockDataProvider, persist: () => void): void {
  // There are no on-chain Crowns outside chain/icp. In icp mode (M1) the server indexer MUST run:
  // the server is the canister's backup, double bookkeeping until the migration ends (migration-plan §0.2).
  const src = process.env.NEXT_PUBLIC_DATA_SOURCE;
  if (src !== "chain" && src !== "icp") return;
  const g = globalThis as unknown as { __indexerOn?: boolean };
  if (g.__indexerOn) return; // one loop per process (survives HMR)
  g.__indexerOn = true;
  void runLoop(store, persist);
}

async function runLoop(store: MockDataProvider, persist: () => void): Promise<void> {
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const treasuryAta = await getAssociatedTokenAddress(mintPubkey(), treasuryPubkey());
  console.log(`[indexer] watching treasury-ATA ${treasuryAta.toBase58()} (RPC ${DEVNET_RPC})`);

  for (;;) {
    try {
      const cursor = (await getMeta(CURSOR_KEY)) ?? undefined;
      const sigs = await fetchNewTreasurySignatures(connection, treasuryAta, cursor);
      let changed = false;
      for (const sig of sigs) {
        // Crown?
        const d = await ingestSignature(store, sig);
        if (d.pending) break; // not finalized yet — retry on the next poll, don't move the cursor
        if (d.ok) changed = true;
        else {
          // Not a Crown — possibly an activation fee.
          const a = await ingestActivation(store, sig);
          if (a.pending) break;
          if (a.ok) changed = true;
        }
        await setMeta(CURSOR_KEY, sig); // processed (Crown / activation / someone else's tx) → move the cursor
        await new Promise((r) => setTimeout(r, 250)); // spare the free RPC (request limits)
      }
      if (changed) persist();
    } catch (e) {
      console.error("[indexer] poll error:", e instanceof Error ? e.message : e);
    }

    // M3: record on-chain claim outcomes BEFORE the settler — so it reads the money truth even for closed escrows.
    try {
      if (ESCROW_PROGRAM_ID) {
        const wrote = await scanEscrowClaims(connection, new PublicKey(ESCROW_PROGRAM_ID));
        if (wrote) persist();
      }
    } catch (e) {
      console.error("[escrow-indexer] error:", e instanceof Error ? e.message : e);
    }

    // Background settler for game tasks (G3a, ADR 0017 / 0015 §2): banks Reign on a TIME-based resolve
    // independently of the browser (Reign is off-chain deterministic from the journal; we don't touch money — claim
    // model). Idempotent: settle() does not touch an already RESOLVED one. A realm without the game → GAME_NOT_ENABLED, skip.
    try {
      const channels = await store.listChannels();
      let settledAny = false;
      for (const c of channels.items) {
        try {
          const r = (await store.gameAction({
            gameId: "escrow-task",
            channelId: c.channelId,
            op: "settleDue",
          })) as { settled: number };
          if (r.settled > 0) settledAny = true;
        } catch (e) {
          // Routine skips (game not enabled) — silently; everything else (RPC, a banking bug) MUST
          // reach the log — otherwise "Reign wasn't credited" is indistinguishable from "nothing to credit".
          const code = e instanceof DataError ? e.code : null;
          if (code !== "GAME_NOT_ENABLED")
            console.error(`[settler] realm ${c.channelId}:`, e instanceof Error ? e.message : e);
        }
      }
      if (settledAny) persist();
    } catch (e) {
      console.error("[settler] error:", e instanceof Error ? e.message : e);
    }

    // Proof anchor: digests of the journal/configs/operator log → memo-tx (transparency of the centralized
    // layer, see server/anchor.ts). Without the ANCHOR_SIGNER_KEYPAIR key it is silently off; a failure does not break the loop.
    // The anchor saves its own record (meta) itself via setMeta — a store persist is not needed.
    try {
      await maybeAnchor(store);
    } catch (e) {
      console.error("[anchor] error:", e instanceof Error ? e.message : e);
    }

    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
