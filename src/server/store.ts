import { MockDataProvider } from "@/lib/data/mock-provider";

/**
 * Серверное хранилище (Фаза 2). In-memory, источник истины — журнал событий; репутация считается тем же
 * ОБЩИМ движком (lib/reputation.ts), что и в моке → цифры совпадают (инвариант §4.4, ADR 0001).
 *
 * В этом окружении нет Postgres/Docker, поэтому persistence — in-memory (стенд-ин под схему
 * backend/schema.sql). Замена на Postgres = заменить внутренности этого слоя, не трогая API и экраны.
 *
 * Singleton кэшируется на globalThis, чтобы переживать HMR в dev и шариться между запросами route-хендлеров.
 */
const globalForStore = globalThis as unknown as { __standingStore?: MockDataProvider };

export function getStore(): MockDataProvider {
  if (!globalForStore.__standingStore) {
    globalForStore.__standingStore = new MockDataProvider();
  }
  return globalForStore.__standingStore;
}
