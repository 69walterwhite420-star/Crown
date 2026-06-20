# ADR 0009 — Fail-closed денежная конфигурация на mainnet (C2)

- **Статус:** принято
- **Дата:** 2026-06-20
- **Контекст:** аудит «как украсть, пока оно на mainnet» нашёл **C2**. Дефолты денежных адресов были
  **fail-open**: `TREASURY_OWNER ?? "<devnet-адрес>"`, `OPERATOR_ADDRESS ?? TREASURY_OWNER`,
  `DEVNET_USDC_MINT ?? "<devnet-USDC>"`. devnet-трежери — закоммиченный в исходник адрес, чей **секретный
  ключ лежит в плейнтекст-файле** `.treasury-devnet.json` (gitignored, но на диске/в бэкапах). Следствия:
  - деплой на mainnet с **забытым** env → вся 3%-комиссия течёт на devnet-адрес с известным ключом → увод
    выручки кем угодно, у кого этот файл;
  - оператор по умолчанию = трежери → один ключ и на деньги, и на T&S-полномочия (`/ops`: бан, ADMIN_VOID).

## Решения

### 1. В production devnet-дефолты не применяются (`src/lib/chain/addresses.ts`)
`devnetOnly(v)` возвращает `""` при `NODE_ENV=production` → трежери/оператор/USDC-mint **обязаны** прийти из
env. Пустые значения роняют денежный путь fail-closed без спец-кода: клиентский `createDonation` →
`NOT_CONFIGURED` (существующий guard на `!TREASURY_OWNER`), пустой оператор → `requireOperator` отказывает
всем (см. §3). Оператор **не наследует** трежери в проде (одноключевой риск, ADR 0006).

### 2. `assertMoneyConfig()` — единая fail-closed проверка
Вне прода — no-op (devnet-дефолты ок). В проде бросает, если: не задан трежери/оператор/mint; задан
**devnet-трежери** (ключ в плейнтексте); **оператор == трежери**. Зовётся в двух точках:
- **startup-хук** `src/instrumentation.ts` (Next 15 `register()`, только `nodejs`-рантайм) — сервер **не
  стартует** на mainnet-мисконфиге;
- **серверный денежный путь** `server/ingest.ts` — backstop перед приёмом доната.

### 3. Защитные guard'ы оператора (`mock-provider.ts`)
`isOperator`/`requireOperator` явно отклоняют пустой `OPERATOR_ADDRESS` (`Boolean(OPERATOR_ADDRESS) && …`,
`!OPERATOR_ADDRESS || …`) — пустой оператор в проде не даёт прав даже теоретически.

## Проверено (next build + next start, curl)
- **build без env** → `BUILD_EXIT=0` (instrumentation не падает на build; `NEXT_PUBLIC_*` инлайнятся пустыми).
- **start без env** → instrumentation бросает `[C2]`, «Failed to prepare server», **HTTP 500 на всё** —
  денежные/любые пути недоступны (деплой видимо сломан, health-check не пройдёт).
- **rebuild с валидным env** (трежери ≠ оператор, mainnet-USDC) → `Ready`, home и RPC `listChannels` → **HTTP 200**
  (нет регрессии для легального деплоя).
- Таблица истинности `assertMoneyConfig` по 6 кейсам (dev/prod × unset/devnet/missing-op/op=treas/valid); `tsc` чист.

## Честные ограничения / открытое
- `NEXT_PUBLIC_*` инлайнятся на этапе **build** → трежери/оператор/mint должны быть заданы во время
  `next build`, не только в рантайме. Задокументировано в `.env.example`.
- Сам **ключ** — операционная ответственность вне кода: свежий mainnet-ключ, мульти-сиг/HSM, увод из
  плейнтекста (`crypto/spec.md`, `docs/legal-and-risk.md`). Этот ADR гарантирует только, что **дефолтный
  devnet-ключ не уедет на mainnet молча**.
- Имя `NEXT_PUBLIC_DEVNET_USDC_MINT` историческое (на mainnet туда кладут mainnet-USDC) — переименование отложено.
- Из аудита остаются открытыми: **H1** (payout диктуется сервером), **H3** (личность на singleton — мина
  перед Postgres), **H2** (сбор за активацию), **M/L** (domain-binding SIWS, finalized, bigint-лимит и т.д.).
