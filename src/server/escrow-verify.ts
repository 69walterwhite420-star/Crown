import { DEVNET_RPC, DEVNET_USDC_MINT, ESCROW_PROGRAM_ID } from "@/lib/chain/addresses";
import { type EscrowAccount, decodeEscrow, escrowPda } from "@/lib/chain/escrow-tx";
import { getMeta } from "@/server/store-db";
import { Connection, PublicKey } from "@solana/web3.js";

/** M3: prefix of the meta-key under which the event indexer writes the on-chain escrow outcome by its PDA (base58). */
export const ESCROW_OUTCOME_META_PREFIX = "escrowOutcome:";

type EscrowOutcome = "to_streamer" | "to_donor";

/**
 * Read the escrow account by hex `task_id`. Returns `{ pda, escrow }` — `escrow=null` if the account is
 * closed (claimed) or does not belong to the program. Returns `null` if escrow is not configured, `task_id`
 * is malformed, or RPC is unavailable. The PDA is needed even for a closed account (for the M3 record), so we return it separately.
 */
async function readEscrowAccount(
  escrowTaskId: string,
): Promise<{ pda: PublicKey; escrow: EscrowAccount | null } | null> {
  if (!ESCROW_PROGRAM_ID || !/^[0-9a-fA-F]{64}$/.test(escrowTaskId)) return null;
  try {
    const programId = new PublicKey(ESCROW_PROGRAM_ID);
    const pda = escrowPda(programId, Uint8Array.from(Buffer.from(escrowTaskId, "hex")));
    const info = await new Connection(DEVNET_RPC, "confirmed").getAccountInfo(pda);
    return { pda, escrow: info && info.owner.equals(programId) ? decodeEscrow(info.data) : null };
  } catch {
    return null; // RPC / decode failure
  }
}

/**
 * Trustless verification of a task's on-chain escrow (G3a, ADR 0017). The server does NOT trust the client that `fund` succeeded:
 * it reads the account from devnet and checks the donor, amount, mint, streamer payout (ESC-6), and that it is FRESH
 * (state == Pending). Any mismatch / failure / closed account → false (fail-closed).
 */
export async function verifyEscrowOnChain(
  escrowTaskId: string,
  expect: { donor: string; amount: string; streamer?: string },
): Promise<boolean> {
  const r = await readEscrowAccount(escrowTaskId);
  if (!r?.escrow) return false;
  const e = r.escrow;
  return (
    e.donor.toBase58() === expect.donor &&
    e.amount === BigInt(expect.amount) &&
    (!DEVNET_USDC_MINT || e.mint.toBase58() === DEVNET_USDC_MINT) &&
    // ESC-6: the escrow must point at the payout of exactly THIS realm; state==Pending means fresh, not reused.
    (!expect.streamer || e.streamer.toBase58() === expect.streamer) &&
    e.state === 0 // 0 = Pending (TaskState)
  );
}

/**
 * ESC-12/M3 — on-chain escrow outcome for reconciling Reign (money = truth). The settler banks Reign
 * only for a KNOWN outcome. A live `resolution` (ToStreamer|ToDonor) applies while the account is open; after closing
 * (claim) we take the outcome from the event indexer's M3 record. `null` — outcome unknown (Unresolved / not yet
 * indexed / RPC failure) → we defer banking (we do not guess from an off-chain timer).
 */
export async function readEscrowOutcome(escrowTaskId: string): Promise<EscrowOutcome | null> {
  const r = await readEscrowAccount(escrowTaskId);
  if (!r) return null; // not configured / malformed id / RPC failure → defer
  if (!r.escrow) {
    // Account closed → the claim outcome recorded by the event indexer (the money truth outlives closure).
    const rec = await getMeta(ESCROW_OUTCOME_META_PREFIX + r.pda.toBase58());
    return rec === "to_streamer" || rec === "to_donor" ? rec : null;
  }
  return r.escrow.resolution === 1 ? "to_streamer" : r.escrow.resolution === 2 ? "to_donor" : null;
}

/**
 * ESC-19 — raw on-chain escrow state (0 Pending, 1 Accepted, 2 Done, 3 Resolved, 4 Disputed). `null` —
 * not configured / malformed id / RPC failure / account closed (claimed). The indexer uses it to reveal the task text
 * on an on-chain `accept` (state≥Accepted) REGARDLESS of the UI: no money reaches the streamer without accept, and accept exposes the text.
 */
export async function readEscrowState(escrowTaskId: string): Promise<number | null> {
  const r = await readEscrowAccount(escrowTaskId);
  return r?.escrow ? r.escrow.state : null;
}
