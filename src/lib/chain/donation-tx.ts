import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { USDC_DECIMALS, splitAmount } from "./config";
import { buildMemoInstruction, encodeActivationMemo, encodeMemo } from "./memo";

export { splitAmount }; // re-export (historic importers take it from here); the definition is in addresses.ts

export interface DonationTxParams {
  donor: PublicKey;
  payout: PublicKey; // owner of the streamer's payout account
  treasury: PublicKey; // treasury owner
  mint: PublicKey; // USDC mint (devnet)
  amountMicro: bigint;
  creatorId: string;
  donationId: string;
  msgRef?: string | null;
}

/**
 * Crown-transaction instructions (docs/yellow-paper.md §3.1): one tx, money goes DIRECTLY donor→streamer (97%) and
 * donor→treasury (3%), the operator never touches the crown funds (non-custodial, invariant §4.1).
 * The streamer's/treasury's ATA is created if missing (paid by the donor). The memo carries attribution.
 */
export async function buildDonationInstructions(
  connection: Connection,
  p: DonationTxParams,
): Promise<TransactionInstruction[]> {
  const { fee, net } = splitAmount(p.amountMicro);
  const donorAta = await getAssociatedTokenAddress(p.mint, p.donor);
  const streamerAta = await getAssociatedTokenAddress(p.mint, p.payout);
  const treasuryAta = await getAssociatedTokenAddress(p.mint, p.treasury);

  const ix: TransactionInstruction[] = [];
  if (!(await accountExists(connection, streamerAta))) {
    ix.push(createAssociatedTokenAccountInstruction(p.donor, streamerAta, p.payout, p.mint));
  }
  if (!(await accountExists(connection, treasuryAta))) {
    ix.push(createAssociatedTokenAccountInstruction(p.donor, treasuryAta, p.treasury, p.mint));
  }
  // 97% to the streamer, 3% to the treasury — two transferChecked instructions.
  ix.push(createTransferCheckedInstruction(donorAta, p.mint, streamerAta, p.donor, net, USDC_DECIMALS));
  ix.push(createTransferCheckedInstruction(donorAta, p.mint, treasuryAta, p.donor, fee, USDC_DECIMALS));
  ix.push(buildMemoInstruction(encodeMemo({ c: p.creatorId, d: p.donationId, m: p.msgRef ?? null })));
  return ix;
}

export interface ActivationTxParams {
  payer: PublicKey; // realm owner
  treasury: PublicKey;
  mint: PublicKey;
  channelId: string;
  feeMicro: bigint;
}

/**
 * Activation-fee instructions (yellow-paper §3.1): one transfer payer→treasury (~$2) + memo `{act}`.
 * A fee, not a deposit — the operator does not refund it (non-custodial). The treasury ATA is created if missing.
 */
export async function buildActivationInstructions(
  connection: Connection,
  p: ActivationTxParams,
): Promise<TransactionInstruction[]> {
  const payerAta = await getAssociatedTokenAddress(p.mint, p.payer);
  const treasuryAta = await getAssociatedTokenAddress(p.mint, p.treasury);
  const ix: TransactionInstruction[] = [];
  if (!(await accountExists(connection, treasuryAta))) {
    ix.push(createAssociatedTokenAccountInstruction(p.payer, treasuryAta, p.treasury, p.mint));
  }
  ix.push(
    createTransferCheckedInstruction(payerAta, p.mint, treasuryAta, p.payer, p.feeMicro, USDC_DECIMALS),
  );
  ix.push(buildMemoInstruction(encodeActivationMemo(p.channelId)));
  return ix;
}

async function accountExists(connection: Connection, addr: PublicKey): Promise<boolean> {
  return (await connection.getAccountInfo(addr)) !== null;
}
