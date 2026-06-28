import { getAssociatedTokenAddress } from "@solana/spl-token";
import { Connection } from "@solana/web3.js";
import { DEVNET_RPC, mintPubkey, treasuryPubkey } from "@/lib/chain/config";
import { fetchNewTreasurySignatures } from "@/lib/chain/indexer";
import type { MockDataProvider } from "@/lib/data/mock-provider";
import { ingestActivation, ingestSignature } from "@/server/ingest";
import { getMeta, setMeta } from "@/server/store-db";

/**
 * Фоновый индексер (Phase 4 / надёжность). Сам следит за цепочкой и доганяет ончейн-донаты НЕЗАВИСИМО от
 * браузера донатера: даже если клиент закрылся до ingest, донат (деньги + очки) не теряется. Все донаты и
 * сборы активации платят комиссию в treasury, поэтому достаточно следить за ОДНИМ адресом — treasury-ATA.
 *
 * RPC берётся из DEVNET_RPC (env NEXT_PUBLIC_DEVNET_RPC; по умолчанию бесплатный публичный) — переход на
 * провайдера (Helius/QuickNode) = смена этой переменной, код не трогаем. Курсор (последняя обработанная
 * подпись) хранится в meta → опрос не начинает с нуля после рестарта. Работает только в chain-режиме.
 *
 * Запускается из store.ts один раз на процесс. ВАЖНО: это долгоживущий цикл — ок для отдельного/локального
 * Node-сервера; в serverless-проде индексер выносят в отдельный воркер/крон (тот же ingestSignature).
 */
const POLL_MS = 20_000;
const CURSOR_KEY = "indexerCursor";

export function startIndexer(store: MockDataProvider, persist: () => void): void {
  if (process.env.NEXT_PUBLIC_DATA_SOURCE !== "chain") return; // ончейн-донатов нет вне chain
  const g = globalThis as unknown as { __indexerOn?: boolean };
  if (g.__indexerOn) return; // один цикл на процесс (переживает HMR)
  g.__indexerOn = true;
  void runLoop(store, persist);
}

async function runLoop(store: MockDataProvider, persist: () => void): Promise<void> {
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const treasuryAta = await getAssociatedTokenAddress(mintPubkey(), treasuryPubkey());
  console.log(`[indexer] слежу за treasury-ATA ${treasuryAta.toBase58()} (RPC ${DEVNET_RPC})`);

  for (;;) {
    try {
      const cursor = (await getMeta(CURSOR_KEY)) ?? undefined;
      const sigs = await fetchNewTreasurySignatures(connection, treasuryAta, cursor);
      let changed = false;
      for (const sig of sigs) {
        // Донат?
        const d = await ingestSignature(store, sig);
        if (d.pending) break; // ещё не финализирован — повторим со следующего опроса, курсор не двигаем
        if (d.ok) changed = true;
        else {
          // Не донат — возможно, сбор активации.
          const a = await ingestActivation(store, sig);
          if (a.pending) break;
          if (a.ok) changed = true;
        }
        await setMeta(CURSOR_KEY, sig); // обработано (донат/активация/чужая tx) → двигаем курсор
        await new Promise((r) => setTimeout(r, 250)); // бережём бесплатный RPC (лимиты запросов)
      }
      if (changed) persist();
    } catch (e) {
      console.error("[indexer] ошибка опроса:", e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
