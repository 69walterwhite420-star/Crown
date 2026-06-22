import { MockDataProvider, type StoreSnapshot } from "@/lib/data/mock-provider";
import { makeSaver, readSnapshot } from "@/server/persist";
import { currentIdentity } from "@/server/request-context";

/**
 * Серверное хранилище (Фаза 2). In-memory, источник истины — журнал событий; репутация считается тем же
 * ОБЩИМ движком (lib/reputation.ts), что и в моке → цифры совпадают (инвариант §4.4, ADR 0001).
 *
 * Персистентность (ADR 0013): состояние грузится из `.data/store.json` при старте и атомарно пишется на
 * диск после мутаций (server/persist.ts) — переживает перезапуск процесса. Это лёгкий стенд-ин под
 * Postgres из backend/schema.sql: замена на БД = заменить внутренности этого слоя, не трогая API и экраны.
 *
 * Singleton и его сейвер кэшируются на globalThis, чтобы переживать HMR в dev и шариться между запросами.
 */
const STORE_FILE = "store.json";
const globalForStore = globalThis as unknown as {
  __standingStore?: MockDataProvider;
  __standingSave?: () => void;
};

export function getStore(): MockDataProvider {
  if (!globalForStore.__standingStore) {
    const store = new MockDataProvider();
    // H3: на сервере личность запроса берётся из per-request AsyncLocalStorage (request-context), а не из
    // мутируемого поля singleton — иначе конкурентные запросы перетирали бы личность друг друга.
    store.__setIdentityResolver(() => currentIdentity() ?? null);
    const snap = readSnapshot<StoreSnapshot>(STORE_FILE); // восстановление с диска (если есть)
    if (snap) store.__restore(snap);
    globalForStore.__standingStore = store;
  }
  // Сейвер привязываем ВСЕГДА (не только при создании): после HMR код персистентности мог появиться позже
  // уже существующего стора — иначе persistStore() остался бы no-op и данные не сохранялись бы до рестарта.
  if (!globalForStore.__standingSave) {
    const store = globalForStore.__standingStore;
    globalForStore.__standingSave = makeSaver(STORE_FILE, () => store.__snapshot());
  }
  return globalForStore.__standingStore;
}

/** Запланировать сохранение стора на диск (троттлинг). Зовётся route-хендлером после мутаций. */
export function persistStore(): void {
  globalForStore.__standingSave?.();
}
