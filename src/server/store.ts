import { MockDataProvider } from "@/lib/data/mock-provider";
import { currentIdentity } from "@/server/request-context";

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
    const store = new MockDataProvider();
    // H3: на сервере личность запроса берётся из per-request AsyncLocalStorage (request-context), а не из
    // мутируемого поля singleton — иначе конкурентные запросы перетирали бы личность друг друга.
    store.__setIdentityResolver(() => currentIdentity() ?? null);
    globalForStore.__standingStore = store;
  }
  return globalForStore.__standingStore;
}
