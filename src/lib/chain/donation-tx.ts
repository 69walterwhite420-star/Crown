import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { FEE_BPS, USDC_DECIMALS } from "./config";
import { buildMemoInstruction, encodeMemo } from "./memo";

/** Целочисленное расщепление суммы: fee = 3%, net = остаток (те же числа, что считает бэкенд/мок). */
export function splitAmount(amountMicro: bigint): { fee: bigint; net: bigint } {
  const fee = (amountMicro * BigInt(FEE_BPS)) / 10000n;
  return { fee, net: amountMicro - fee };
}

export interface DonationTxParams {
  donor: PublicKey;
  payout: PublicKey; // владелец payout-аккаунта стримера
  treasury: PublicKey; // владелец трежери
  mint: PublicKey; // USDC mint (devnet)
  amountMicro: bigint;
  creatorId: string;
  donationId: string;
  msgRef?: string | null;
}

/**
 * Инструкции донат-транзакции (crypto/spec.md §3): одна tx, деньги идут НАПРЯМУЮ донор→стример (97%) и
 * донор→трежери (3%), оператор средства доната не трогает (некастодиальность, инвариант §4.1).
 * ATA стримера/трежери создаются при отсутствии (платит донор). Memo несёт атрибуцию.
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
  // 97% стримеру, 3% трежери — две transferChecked-инструкции.
  ix.push(createTransferCheckedInstruction(donorAta, p.mint, streamerAta, p.donor, net, USDC_DECIMALS));
  ix.push(createTransferCheckedInstruction(donorAta, p.mint, treasuryAta, p.donor, fee, USDC_DECIMALS));
  ix.push(buildMemoInstruction(encodeMemo({ c: p.creatorId, d: p.donationId, m: p.msgRef ?? null })));
  return ix;
}

async function accountExists(connection: Connection, addr: PublicKey): Promise<boolean> {
  return (await connection.getAccountInfo(addr)) !== null;
}
