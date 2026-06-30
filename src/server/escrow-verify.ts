import { DEVNET_RPC, DEVNET_USDC_MINT, ESCROW_PROGRAM_ID } from "@/lib/chain/addresses";
import { decodeEscrow, escrowPda } from "@/lib/chain/escrow-tx";
import { Connection, PublicKey } from "@solana/web3.js";

/**
 * Трастлесс-сверка ончейн-эскроу задания (G3a, ADR 0017). Сервер НЕ верит клиенту, что `fund` реально
 * прошёл: читает аккаунт эскроу из devnet по `escrowTaskId` и проверяет, что он принадлежит нашей программе
 * и совпадает по донору, сумме и mint. Возвращает false при любом несовпадении/сбое (fail-closed) — задание
 * без подтверждённого эскроу не записывается. Только сервер (тянет web3.js; в стор инжектится динамически).
 */
export async function verifyEscrowOnChain(
  escrowTaskId: string,
  expect: { donor: string; amount: string },
): Promise<boolean> {
  if (!ESCROW_PROGRAM_ID) return false; // не настроено — не пропускаем (fail-closed)
  try {
    if (!/^[0-9a-fA-F]{64}$/.test(escrowTaskId)) return false; // ровно 32 байта hex
    const programId = new PublicKey(ESCROW_PROGRAM_ID);
    const taskId = Uint8Array.from(Buffer.from(escrowTaskId, "hex"));
    const pda = escrowPda(programId, taskId);
    const conn = new Connection(DEVNET_RPC, "confirmed");
    const info = await conn.getAccountInfo(pda);
    if (!info || !info.owner.equals(programId)) return false;
    const e = decodeEscrow(info.data);
    if (e.donor.toBase58() !== expect.donor) return false;
    if (e.amount !== BigInt(expect.amount)) return false;
    if (DEVNET_USDC_MINT && e.mint.toBase58() !== DEVNET_USDC_MINT) return false;
    return true;
  } catch {
    return false; // битый id / сбой RPC / decode → не пропускаем
  }
}
