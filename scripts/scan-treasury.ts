/**
 * Диагностика: листает последние tx в трежери (devnet) и классифицирует каждую как донат/активацию,
 * показывая донора, получателя 97%-ноги и суммы. Помогает понять, куда реально уходят деньги.
 *   npx tsx scripts/scan-treasury.ts
 */
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { Connection } from "@solana/web3.js";
import { DEVNET_RPC, mintPubkey, treasuryPubkey } from "../src/lib/chain/config";
import { extractActivation, extractDonation, fetchNewTreasurySignatures } from "../src/lib/chain/indexer";

const API = process.env.STANDING_API ?? "http://localhost:3000/api/v1/rpc";
const DO_INGEST = process.argv.includes("--ingest");

async function ingest(method: string, args: unknown[]): Promise<string> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, args }),
  });
  return res.text();
}

async function main(): Promise<void> {
  const connection = new Connection(DEVNET_RPC, "finalized");
  const mint = mintPubkey();
  const treasuryAta = await getAssociatedTokenAddress(mint, treasuryPubkey());
  console.log("treasury ATA:", treasuryAta.toBase58(), "\n");

  const sigs = await fetchNewTreasurySignatures(connection, treasuryAta);
  console.log(`последние ${sigs.length} подписей в трежери:\n`);

  for (const sig of sigs) {
    const tx = await connection.getParsedTransaction(sig, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
    const don = extractDonation(tx, sig, { mint, treasuryAta });
    const act = extractActivation(tx, sig, { mint, treasuryAta });
    if (don) {
      console.log(`ДОНАТ   ${sig}`);
      console.log(`  донор:        ${don.donor}`);
      console.log(`  97%-нога ATA: ${don.streamerAta}`);
      console.log(`  сумма:        ${Number(don.amountMicro) / 1e6} USDC (net ${Number(don.netMicro) / 1e6} / fee ${Number(don.feeMicro) / 1e6})`);
      console.log(`  memo:         ${JSON.stringify(don.memo)}`);
      if (DO_INGEST) console.log(`  → ingestSignature: ${await ingest("ingestSignature", [sig])}`);
      console.log("");
    } else if (act) {
      console.log(`АКТИВАЦИЯ ${sig.slice(0, 12)}… payer=${act.payer} ${Number(act.amountMicro) / 1e6} USDC channel=${act.channelId}\n`);
    } else {
      console.log(`(не распознано) ${sig.slice(0, 12)}…\n`);
    }
  }
}

main().catch((e) => {
  console.error("scan fatal:", e);
  process.exit(1);
});
