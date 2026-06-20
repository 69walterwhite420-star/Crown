import { TransactionInstruction } from "@solana/web3.js";
import { MEMO_PROGRAM_ID } from "./config";

/** memo-атрибуция в донат-транзакции (crypto/spec.md §3): creator_id, donation_id, msg_ref. */
export interface MemoAttribution {
  c: string; // creator_id (channelId)
  d: string; // donation_id
  m: string | null; // msg_ref (опц.)
}

export function encodeMemo(a: MemoAttribution): string {
  return JSON.stringify({ c: a.c, d: a.d, m: a.m });
}

export function decodeMemo(raw: string): MemoAttribution | null {
  try {
    const o = JSON.parse(raw) as Partial<MemoAttribution>;
    if (typeof o.c === "string" && typeof o.d === "string") {
      return { c: o.c, d: o.d, m: typeof o.m === "string" ? o.m : null };
    }
  } catch {
    /* не наш memo */
  }
  return null;
}

export function buildMemoInstruction(memo: string): TransactionInstruction {
  return new TransactionInstruction({
    keys: [],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memo, "utf8"),
  });
}
