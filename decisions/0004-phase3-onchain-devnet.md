# ADR 0004 — Фаза 3: ончейн на devnet (web3.js v1, гибрид, код-сплит)

- **Статус:** принято
- **Дата:** 2026-06-19
- **Контекст:** Фаза 3 — реальные деньги на Solana (crypto/spec.md). Калибровка на devnet.

## Решения

### 1. Стек — web3.js v1 (+ @solana/spl-token), не @solana/kit
Спека предлагала @solana/kit / gill, но просила «зафиксировать один путь в начале фазы» из-за того, что
**wallet-adapter завязан на web3.js v1**. Чтобы не городить v1↔v2 compat-мост, фиксируемся на **v1**:
`@solana/web3.js@1`, `@solana/spl-token`, `@solana/wallet-adapter-*`. Это самый зрелый и совместимый путь.
(Сверка перед установкой — как требует спека; миграция на kit возможна позже отдельным ADR.)

### 2. Ончейн-механика — чистые модули, проверяемые без кошелька
- `src/lib/chain/donation-tx.ts` — `buildDonationInstructions` (одна tx: ATA-при-необходимости, 97%
  стримеру, 3% трежери, memo) и `splitAmount`. Деньги идут донор→стример/трежери напрямую
  (некастодиальность, инвариант §4.1).
- `src/lib/chain/indexer.ts` — `extractDonation` (ЧИСТАЯ: реконструкция доната из parsed-tx, валидация
  пары 97/3 + memo, самоконтроль комиссии) + `parseDonationTx` (обёртка с RPC) + вотчер трежери.
- `src/lib/chain/memo.ts`, `config.ts`.

Выделение `extractDonation` в чистую функцию позволило **детерминированно проверить разбор/валидацию**
без сети (синтетические tx), а сборщик — против реального devnet (RPC-чтения).

### 3. ChainDataProvider — гибрид (crypto/spec.md §7)
Чтение (репутация/каналы/модерация/баны) — из оффчейн-бэкенда (его кормит индексер) → делегируется
`ApiDataProvider`. Запись денег — через кошелёк: `connect` (SIWS, gasless), `createDonation` (сборка tx +
подпись кошельком, оптимистичный результат; финальный зачёт — индексер). Кошелёк инжектится из
React-дерева (`useWallet`) в класс через `setWallet` (класс не вызывает хуки).

### 4. Код-сплит chain-провайдеров
`ChainProviders` (wallet-adapter + ChainDataProvider) грузятся **динамическим чанком** (`next/dynamic`,
`ssr:false`) только при `NEXT_PUBLIC_DATA_SOURCE=chain`. Так тяжёлый Solana-стек НЕ попадает в bundle
mock/api (подтверждено build: shared First Load JS ~103 КБ, страницы 103–167 КБ).

## Проверено / не проверено

**Проверено (devnet + детерминированно):** сборщик tx против devnet (5 инструкций: 2×ATA + 2×transfer +
memo, декод memo, расщепление 97/3); индексер на синтетических tx (корректный донат; отбраковка неверного
расщепления, без memo, ошибочной tx); `npm run build` зелёный; typecheck/lint чисты.

**НЕ проверено (внешние ограничения):**
- **Реальная отправка транзакции на devnet** — devnet-фасет airdrop отдаёт 429 (дневной лимит/пуст).
  Скрипт полной отправки готов: `scripts/devnet-smoke.ts` (запустить, когда будет тестовый SOL —
  через faucet.solana.com или профинансировав donor-адрес).
- **Браузерный флоу кошелька** (Phantom/Solflare connect, SIWS, подпись доната) — headless не проверить;
  верификация в браузере с devnet-кошельком: `NEXT_PUBLIC_DATA_SOURCE=chain` + заданные
  `NEXT_PUBLIC_DEVNET_USDC_MINT` / `NEXT_PUBLIC_TREASURY_OWNER`.

## Несжимаемый остаток (mainnet)
Перед хостингом чужих средств на mainnet — живая юр-консультация в выбранной юрисдикции
(`docs/legal-and-risk.md`, мастер-переменная). Эта фаза — только механика на devnet.
