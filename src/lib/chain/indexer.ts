import {
  Connection,
  ParsedInstruction,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  PublicKey,
} from "@solana/web3.js";
import { splitAmount } from "./donation-tx";
import { decodeActivationMemo, decodeMemo, type MemoAttribution } from "./memo";

/** The truth about money is the chain, not the client (yellow-paper §5.1). A crown reconstructed from on-chain. */
export interface IndexedDonation {
  signature: string;
  donor: string;
  amountMicro: bigint;
  feeMicro: bigint;
  netMicro: bigint;
  streamerAta: string; // ATA recipient of the 97% leg — checked against the realm's payout by the caller
  memo: MemoAttribution;
  blockTime: number | null;
}

interface SplTransferParsed {
  type: string;
  info: {
    authority: string;
    destination: string;
    mint: string;
    source: string;
    tokenAmount: { amount: string; decimals: number };
  };
}

function isParsed(ix: ParsedInstruction | PartiallyDecodedInstruction): ix is ParsedInstruction {
  return (ix as ParsedInstruction).parsed !== undefined;
}

export async function parseDonationTx(
  connection: Connection,
  signature: string,
  opts: { mint: PublicKey; treasuryAta: PublicKey; commitment?: "confirmed" | "finalized" },
): Promise<IndexedDonation | null> {
  // M2: in chain mode crediting waits for "finalized" (protection against a reorg on mainnet); "confirmed" — for devnet responsiveness.
  const tx = await connection.getParsedTransaction(signature, {
    commitment: opts.commitment ?? "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  return extractDonation(tx, signature, opts);
}

/**
 * Pure parse: finds the fee leg (transferChecked into treasuryAta) and the paired net leg (another
 * transferChecked of the same mint from the same donor → streamer's ATA) + memo. Self-check of the fee: without a
 * correct 97/3 split it returns null (a raw transfer ≠ a crown). Extracted for deterministic tests.
 */
export function extractDonation(
  tx: ParsedTransactionWithMeta | null,
  signature: string,
  opts: { mint: PublicKey; treasuryAta: PublicKey },
): IndexedDonation | null {
  if (!tx || tx.meta?.err) return null;
  const mint = opts.mint.toBase58();
  const treasury = opts.treasuryAta.toBase58();

  const transfers: { dest: string; amount: bigint; authority: string }[] = [];
  let memo: MemoAttribution | null = null;

  for (const ix of tx.transaction.message.instructions) {
    if (!isParsed(ix)) continue;
    if (ix.program === "spl-memo" && typeof ix.parsed === "string") {
      memo = decodeMemo(ix.parsed);
      continue;
    }
    if (ix.program === "spl-token") {
      const parsed = ix.parsed as SplTransferParsed;
      if (parsed.type !== "transferChecked" || parsed.info?.mint !== mint) continue;
      transfers.push({
        dest: parsed.info.destination,
        amount: BigInt(parsed.info.tokenAmount.amount),
        authority: parsed.info.authority,
      });
    }
  }

  // Good-faith parse (R2/ADR 0012): a crown tx from our builder carries EXACTLY two legs of this mint (net +
  // fee). A different count → not our tx (extra legs could shift the netLeg onto a foreign ATA) — reject it.
  if (transfers.length !== 2 || !memo) return null;
  const feeLeg = transfers.find((t) => t.dest === treasury);
  const netLeg = transfers.find((t) => t.dest !== treasury);
  if (!feeLeg || !netLeg) return null;
  if (feeLeg.authority !== netLeg.authority) return null;

  const amount = feeLeg.amount + netLeg.amount;
  const expected = splitAmount(amount);
  if (expected.fee !== feeLeg.amount || expected.net !== netLeg.amount) return null;

  return {
    signature,
    donor: netLeg.authority,
    amountMicro: amount,
    feeMicro: feeLeg.amount,
    netMicro: netLeg.amount,
    streamerAta: netLeg.dest,
    memo,
    blockTime: tx.blockTime ?? null,
  };
}

/** An activation fee reconstructed from on-chain: one transfer payer→treasuryATA + memo `{act}`. */
export interface IndexedActivation {
  signature: string;
  payer: string; // the transfer authority — checked against the realm owner by the caller
  amountMicro: bigint;
  channelId: string;
  blockTime: number | null;
}

/**
 * Pure parse of the activation fee: looks for a transferChecked of the right mint into treasuryAta + memo `{act}`.
 * The amount is NOT validated here (ingest checks the threshold against ACTIVATION_FEE_MICRO). Extracted for tests.
 */
export function extractActivation(
  tx: ParsedTransactionWithMeta | null,
  signature: string,
  opts: { mint: PublicKey; treasuryAta: PublicKey },
): IndexedActivation | null {
  if (!tx || tx.meta?.err) return null;
  const mint = opts.mint.toBase58();
  const treasury = opts.treasuryAta.toBase58();

  const transfers: { dest: string; amount: bigint; authority: string }[] = [];
  let act: string | null = null;

  for (const ix of tx.transaction.message.instructions) {
    if (!isParsed(ix)) continue;
    if (ix.program === "spl-memo" && typeof ix.parsed === "string") {
      act = decodeActivationMemo(ix.parsed)?.act ?? act;
      continue;
    }
    if (ix.program === "spl-token") {
      const parsed = ix.parsed as SplTransferParsed;
      if (parsed.type !== "transferChecked" || parsed.info?.mint !== mint) continue;
      transfers.push({
        dest: parsed.info.destination,
        amount: BigInt(parsed.info.tokenAmount.amount),
        authority: parsed.info.authority,
      });
    }
  }

  // An activation tx from our builder carries EXACTLY one leg of this mint — into the treasury. Otherwise → not our tx.
  if (transfers.length !== 1 || !act) return null;
  const leg = transfers[0];
  if (!leg || leg.dest !== treasury) return null;
  return {
    signature,
    payer: leg.authority,
    amountMicro: leg.amount,
    channelId: act,
    blockTime: tx.blockTime ?? null,
  };
}

/** New signatures incoming to the treasury ATA after `afterSignature` (for the indexer service). */
export async function fetchNewTreasurySignatures(
  connection: Connection,
  treasuryAta: PublicKey,
  afterSignature?: string,
): Promise<string[]> {
  const sigs = await connection.getSignaturesForAddress(treasuryAta, {
    until: afterSignature,
    limit: 50,
  });
  return sigs
    .filter((s) => !s.err)
    .map((s) => s.signature)
    .reverse();
}

/** M3: new SUCCESSFUL signatures of the escrow program after `afterSignature` (for the claim event indexer). */
export async function fetchNewProgramSignatures(
  connection: Connection,
  programId: PublicKey,
  afterSignature?: string,
): Promise<string[]> {
  const sigs = await connection.getSignaturesForAddress(programId, {
    until: afterSignature,
    limit: 50,
  });
  return sigs
    .filter((s) => !s.err)
    .map((s) => s.signature)
    .reverse();
}
