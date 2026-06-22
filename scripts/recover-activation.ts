/**
 * Одноразовая диагностика/восстановление: находит ончейн-сборы активации в трежери (devnet) и, по флагу
 * --ingest, повторно зовёт ingestActivation на работающем сервере (идемпотентно, без повторной оплаты).
 * Нужно, когда сбор уплачен, но канал не активировался из-за гонки confirmed↔finalized (CHAIN_MODE=on).
 *
 *   npx tsx scripts/recover-activation.ts            # только показать найденные сборы
 *   npx tsx scripts/recover-activation.ts --ingest   # + завершить активацию через локальный сервер
 */
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { Connection } from "@solana/web3.js";
import { DEVNET_RPC, mintPubkey, treasuryPubkey } from "../src/lib/chain/config";
import { extractActivation, fetchNewTreasurySignatures } from "../src/lib/chain/indexer";

const API = process.env.STANDING_API ?? "http://localhost:3000/api/v1/rpc";
const DO_INGEST = process.argv.includes("--ingest");

async function main(): Promise<void> {
  const connection = new Connection(DEVNET_RPC, "finalized");
  const mint = mintPubkey();
  const treasury = treasuryPubkey();
  const treasuryAta = await getAssociatedTokenAddress(mint, treasury);
  console.log("treasury:", treasury.toBase58());
  console.log("treasury ATA:", treasuryAta.toBase58());

  const sigs = await fetchNewTreasurySignatures(connection, treasuryAta);
  console.log(`найдено ${sigs.length} подписей в трежери (последние)`);

  let found = 0;
  for (const sig of sigs) {
    const tx = await connection.getParsedTransaction(sig, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
    const act = extractActivation(tx, sig, { mint, treasuryAta });
    if (!act) continue;
    found++;
    const usdc = Number(act.amountMicro) / 1e6;
    console.log(`\n— АКТИВАЦИЯ —`);
    console.log("  signature:", sig);
    console.log("  channelId:", act.channelId);
    console.log("  payer:    ", act.payer);
    console.log("  amount:   ", usdc, "USDC");

    if (DO_INGEST) {
      const res = await fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "ingestActivation", args: [sig] }),
      });
      console.log("  → ingestActivation:", await res.text());
    }
  }
  if (!found) console.log("\nсборов активации в последних подписях трежери не найдено.");
  else if (!DO_INGEST) console.log("\nЗапусти с --ingest, чтобы завершить активацию (без повторной оплаты).");
}

main().catch((e) => {
  console.error("recover fatal:", e);
  process.exit(1);
});
