/**
 * Индексер-сервис (Фаза 3, crypto/spec.md §4): «истина о деньгах — цепочка». Опрашивает treasury ATA на
 * devnet, и для каждой новой подписи зовёт бэкенд `ingestSignature` (сервер сам достаёт tx и валидирует).
 * Идемпотентно (повтор не дублирует). Запуск рядом с `npm run dev`: `npx tsx scripts/indexer.ts`.
 */
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { Connection } from "@solana/web3.js";
import { DEVNET_RPC, mintPubkey, treasuryPubkey } from "../src/lib/chain/config";
import { fetchNewTreasurySignatures } from "../src/lib/chain/indexer";
import { decode, encode } from "../src/lib/data/codec";

const API = process.env.STANDING_API ?? "http://localhost:3000/api/v1/rpc";
const POLL_MS = 8000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ingest(signature: string): Promise<unknown> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: encode({ method: "ingestSignature", args: [signature] }),
  });
  return decode<{ ok: boolean; result?: unknown; error?: unknown }>(await res.text());
}

async function main(): Promise<void> {
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const treasuryAta = await getAssociatedTokenAddress(mintPubkey(), treasuryPubkey());
  console.log("indexer → treasury ATA:", treasuryAta.toBase58());
  console.log("indexer → backend:", API);

  // Старт с текущего конца истории — не переигрываем прошлое (ingest всё равно идемпотентен).
  let last: string | undefined = (await fetchNewTreasurySignatures(connection, treasuryAta)).pop();

  for (;;) {
    try {
      const sigs = await fetchNewTreasurySignatures(connection, treasuryAta, last);
      for (const sig of sigs) {
        const r = await ingest(sig);
        console.log("ingest", sig.slice(0, 16), "→", JSON.stringify(r));
        last = sig;
      }
    } catch (e) {
      console.log("poll error:", String(e));
    }
    await sleep(POLL_MS);
  }
}

main().catch((e) => {
  console.error("indexer fatal:", e);
  process.exit(1);
});
