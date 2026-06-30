/**
 * Смоук эскроу-программы (G3a) против ЖИВОЙ программы на devnet. Проверяет билдеры `escrow-tx.ts` и сам
 * контракт end-to-end на СВОЁМ тестовом mint (не Circle USDC — нужен mint authority):
 *   happy:  fund → accept → mark_done → resolve_dispute(toStreamer) → claim_streamer  (97/3, эскроу закрыт)
 *   refund: fund → reject → claim_donor  (100% назад)
 *
 * Запуск (на машине с тулчейном):
 *   export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
 *   npx tsx scripts/escrow-smoke.ts
 * Платит кошелёк ~/.config/solana/id.json (он же донор); нужен devnet-SOL.
 */
import {
  createMint,
  getAccount,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  buildClaimDonorIxs,
  buildClaimStreamerIxs,
  buildFundIx,
  buildMarkDoneIx,
  buildRejectIx,
  escrowPda,
} from "../src/lib/chain/escrow-tx";

const RPC = process.env.NEXT_PUBLIC_DEVNET_RPC ?? "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID ?? "GPP2BCNMp8peLh3uySuEqPb2gWanr4xw5Lf3X7Kx7GU4",
);
const AMOUNT = 5_000_000n; // 5 USDC
const FEE = (AMOUNT * 300n) / 10_000n; // 0.15
const NET = AMOUNT - FEE; // 4.85
const EXEC_WINDOW = 3600n;

function loadPayer(): Keypair {
  const path = `${homedir()}/.config/solana/id.json`;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}
function randTaskId(): Uint8Array {
  const a = new Uint8Array(32);
  for (let i = 0; i < 32; i++) a[i] = Math.floor(Math.random() * 256);
  return a;
}
async function send(
  conn: Connection,
  ixs: TransactionInstruction[],
  payer: Keypair,
  signers: Keypair[],
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = payer.publicKey;
  return sendAndConfirmTransaction(conn, tx, [payer, ...signers], { commitment: "confirmed" });
}
const bal = async (conn: Connection, ata: PublicKey) => {
  try {
    return (await getAccount(conn, ata)).amount;
  } catch {
    return 0n;
  }
};
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("  ok:", msg);
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const payer = loadPayer(); // = донор
  const donor = payer;
  const streamer = Keypair.generate();
  const treasury = Keypair.generate();
  const resolver = Keypair.generate();
  console.log("program:", PROGRAM_ID.toBase58());
  console.log("payer/donor:", payer.publicKey.toBase58(), "balance:", await conn.getBalance(payer.publicKey) / 1e9, "SOL");

  // тестовый mint (6 знаков), authority = payer
  const mint = await createMint(conn, payer, payer.publicKey, null, 6);
  const donorAta = (await getOrCreateAssociatedTokenAccount(conn, payer, mint, donor.publicKey)).address;
  await mintTo(conn, payer, mint, donorAta, payer, Number(AMOUNT) * 2); // 10 USDC донору
  console.log("mint:", mint.toBase58());
  // Стример сам платит газ+ренту при claim (claim-модель, ADR 0015 §7) — в смоуке выдаём ему немного SOL.
  await send(conn, [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: streamer.publicKey, lamports: 20_000_000 })], payer, []);

  // ───────── happy-path ─────────
  console.log("\n[happy] fund → accept → done → resolve(toStreamer) → claim_streamer");
  const t1 = randTaskId();
  const escrow1 = escrowPda(PROGRAM_ID, t1);
  await send(conn, [await buildFundIx({ programId: PROGRAM_ID, donor: donor.publicKey, streamer: streamer.publicKey, treasury: treasury.publicKey, resolver: resolver.publicKey, mint, taskId: t1, amount: AMOUNT, executionWindow: EXEC_WINDOW })], payer, []);
  assert((await conn.getAccountInfo(escrow1)) !== null, "эскроу создан после fund");
  // accept больше не ончейн (бесплатный оффчейн-шаг) → «Готово» сразу из Pending.
  await send(conn, [buildMarkDoneIx(PROGRAM_ID, streamer.publicKey, t1)], payer, [streamer]);
  // resolve_dispute импортируется отдельно
  const { buildResolveDisputeIx } = await import("../src/lib/chain/escrow-tx");
  await send(conn, [buildResolveDisputeIx(PROGRAM_ID, resolver.publicKey, t1, true)], payer, [resolver]);
  await send(conn, await buildClaimStreamerIxs(conn, { programId: PROGRAM_ID, streamer: streamer.publicKey, donor: donor.publicKey, treasury: treasury.publicKey, mint, taskId: t1 }), payer, [streamer]);
  const streamerAta = await getAssociatedTokenAddress(mint, streamer.publicKey);
  const treasuryAta = await getAssociatedTokenAddress(mint, treasury.publicKey);
  assert((await bal(conn, streamerAta)) === NET, `стример получил 97% (${NET})`);
  assert((await bal(conn, treasuryAta)) === FEE, `трежери получило 3% (${FEE})`);
  assert((await conn.getAccountInfo(escrow1)) === null, "эскроу закрыт после claim");

  // ───────── refund-path ─────────
  console.log("\n[refund] fund → reject → claim_donor (100%)");
  const before = await bal(conn, donorAta);
  const t2 = randTaskId();
  await send(conn, [await buildFundIx({ programId: PROGRAM_ID, donor: donor.publicKey, streamer: streamer.publicKey, treasury: treasury.publicKey, resolver: resolver.publicKey, mint, taskId: t2, amount: AMOUNT, executionWindow: EXEC_WINDOW })], payer, []);
  assert((await bal(conn, donorAta)) === before - AMOUNT, "сумма списана в эскроу");
  await send(conn, [buildRejectIx(PROGRAM_ID, streamer.publicKey, t2)], payer, [streamer]);
  await send(conn, await buildClaimDonorIxs(conn, { programId: PROGRAM_ID, donor: donor.publicKey, mint, taskId: t2 }), payer, []);
  assert((await bal(conn, donorAta)) === before, "донору вернулось 100%");

  console.log("\n✅ ВСЕ ПРОВЕРКИ ПРОШЛИ");
}

main().catch((e) => {
  console.error("\n❌", e?.message ?? e);
  if (e?.logs) console.error(e.logs.join("\n"));
  process.exit(1);
});
