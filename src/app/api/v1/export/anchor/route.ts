import { encode } from "@/lib/data/codec";
import { anchorStatus, computeAnchorBundle } from "@/server/anchor";
import { getStore } from "@/server/store";

export const dynamic = "force-dynamic";

/**
 * Публичный прообраз пруф-якоря: полный журнал репутации и все версии конфигов (публичные данные) +
 * ПЕР-ЗАПИСНЫЕ ХЭШИ лога модерации (инциденты/операторские действия — их содержимое приватно, §4.6,
 * наружу не уходит) + текущие дайджесты и последний опубликованный якорь. Третья сторона пересчитывает
 * дайджесты из этого экспорта и сверяет с memo ончейн (scripts/verify-export.ts) — тихая переписка
 * прошлого ловится.
 */
export async function GET(): Promise<Response> {
  const store = await getStore();
  const { ledger, configs } = store.exportAnchorData();
  const bundle = await computeAnchorBundle(store);
  return new Response(
    encode({
      format: "standing-anchor-export/1",
      generatedAt: new Date().toISOString(),
      digests: bundle.digests,
      ledgerCount: bundle.ledgerCount,
      lastAnchor: await anchorStatus(),
      ledger,
      configs,
      incidentHashes: bundle.incidentHashes,
      actionHashes: bundle.actionHashes,
    }),
    { headers: { "content-type": "application/json" } },
  );
}
