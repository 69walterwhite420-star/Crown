# ADR 0005 — Реальные devnet-кошельки, без фикстур, трастлесс-приём

- **Статус:** принято
- **Дата:** 2026-06-20
- **Контекст:** переход от демо-заглушек к реальному devnet: подключать настоящие кошельки, убрать
  стаб-каналы (lumi/nova/kebab) и dev-переключатель личностей, делать реальные ончейн-проверки.

## Решения

### 1. Личность = реальный адрес кошелька (не IdentityKey)
Удалены `DEV_SESSIONS`/`IdentityKey`. Стор хранит `sessionAddress: string | null`; `session()` выводит
`isCreator` (владеет каналом) и `isOperator` (`address === OPERATOR_ADDRESS`). Адрес шлётся с каждым RPC
(`body.address`). Под `chain` его задаёт кошелёк (`ChainDataProvider.setWallet → ApiDataProvider.__setAddress`),
под `api`/`mock` — dev-ввод адреса (тулбар / `/connect`).

### 2. Никаких фикстур — пустой стор
`fixtures.ts` теперь только дефолты (`DEFAULT_TIERS` + `defaultChannelConfig`). Каналы создают
пользователи (`createChannel` по адресу кошелька). Discovery показывает реальные каналы.

### 3. Трастлесс-приём ончейн-донатов
`createDonation` под chain отправляет реальную tx (USDC 97/3 + memo) кошельком, ждёт `confirmed` и зовёт
`ingestSignature(sig)`. Сервер (`server/ingest.ts`) САМ достаёт tx из devnet, валидирует пару 97/3 + memo
и сверяет, что 97%-нога ушла на payout-ATA канала из memo — **не верит клиенту** (истина — цепочка).
Запись идемпотентна по signature. Тот же `ingestSignature` зовёт и индексер-сервис (`scripts/indexer.ts`,
опрашивает treasury ATA). Чистый разбор — `extractDonation` (двухпроходный: нога-комиссия → парная нога-нетто).

### 4. Деньги: Circle devnet USDC + сгенерированный трежери
`DEVNET_USDC_MINT = 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (Circle, пополнение через faucet.circle.com).
Трежери сгенерирован (`9tSWouwVrPahnnLW4AMQcNn53Uk5okFEdduo1M3Gtrpe`), секрет в `.treasury-devnet.json`
(gitignored). Строковые адреса — в `src/lib/chain/addresses.ts` (без web3.js → серверный стор их импортит,
не таща Solana в bundle mock/api). PublicKey-обёртки — в `config.ts`.

### 5. chain — основной режим; mock/api — dev-fallback
`NEXT_PUBLIC_DATA_SOURCE=chain` по умолчанию. Wallet-adapter и web3.js — динамическим чанком только под
chain (build: shared ~103 КБ). `WalletMultiButton` — реальная кнопка подключения.

## Проверено / не проверено

**Проверено (headless):** реальный backend-флоу по RPC — пустой Discovery, createChannel по адресу →
activate → Discovery, isCreator/isOperator по адресу; сборщик tx против devnet; индексер (extractDonation)
на синтетике + самоконтроль комиссии; `next build` (chain) зелёный; typecheck/lint чисты.

**НЕ проверено (нужен браузер/SOL):** подключение Phantom, подпись, реальная отправка USDC-доната на
devnet и приём индексером. Проверяет пользователь: кошелёк на devnet с SOL (faucet.solana.com) и USDC
(faucet.circle.com). Полная headless-отправка — `scripts/devnet-smoke.ts` (нужен devnet SOL; airdrop 429).

## Честные ограничения
- Persistence — in-memory (нет БД): каналы/репутация сбрасываются при перезапуске сервера. Уйдёт с Postgres.
- Сбор активации — пока оффчейн-флип (ончейн-сбор по образцу доната — TODO).
- Перед mainnet — юр-консультация (мастер-переменная, `docs/legal-and-risk.md`).
