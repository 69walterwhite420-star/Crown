# Эскроу-программа `escrow-task` — сборка, тест, деплой (G3a, devnet)

Некастодиальная эскроу-программа для мини-игры «задание-донат». Проект и инварианты —
[`decisions/0017-escrow-onchain-devnet-design.md`](../decisions/0017-escrow-onchain-devnet-design.md).

> **Статус: исходник написан, в dev-окружении Standing НЕ собран.** Песочница не может линковать
> хост-артефакты (proc-макросы Anchor): нет gcc-стартап-объектов `crtbeginS.o/crtendS.o` и `libgcc_s`,
> а поставить `build-essential` нельзя без sudo. Деплой отдельно заблокирован (devnet airdrop 429).
> Сборка/тест/деплой выполняются на машине с полным тулчейном по шагам ниже.

## 0. Предпосылки (тулчейн)

```sh
# C-тулчейн (для хост-сборки proc-макросов) — ИМЕННО этого не хватало в песочнице Standing:
sudo apt-get install -y build-essential        # gcc + crt*.o + libgcc — обязательно

# Rust:
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
. "$HOME/.cargo/env"

# Solana CLI (Agave):
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Anchor через avm:
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install 0.31.1 && avm use 0.31.1
```

## 1. Сборка

```sh
cd anchor
anchor build            # компилирует программу под SBF + генерит IDL и target/types/escrow_task.ts
anchor keys sync        # вписывает реальный program id в lib.rs (declare_id!) и Anchor.toml
anchor build            # пересобрать с настоящим id
```

## 2. Локальные тесты

```sh
npm install             # зависимости для ts-mocha (см. package.json)
anchor test             # поднимает локальный валидатор и гоняет tests/escrow-task.ts
```

Покрыты happy-path (fund→accept→done→resolve→claim_streamer, 97/3) и refund (reject→claim_donor, 100%).
Пути по таймауту (72ч/12ч/no-show) требуют варпа часов валидатора — отдельный харнесс.

## 3. Деплой на devnet

```sh
solana config set --url devnet
solana-keygen new -o ~/.config/solana/id.json   # если ключа ещё нет
solana airdrop 5                                 # ⚠️ часто 429 — см. ниже
anchor deploy --provider.cluster devnet
```

**Если airdrop отдаёт 429** (известная проблема, ROADMAP Фаза 3): получить devnet-SOL иначе —
веб-фасет `https://faucet.solana.com` (по адресу `solana address`), фасет QuickNode/Helius, или перевод
с другого devnet-кошелька. На деплой программы нужно ~3–5 SOL.

## 4. Подключить к приложению

После деплоя:
1. Прописать `NEXT_PUBLIC_ESCROW_PROGRAM_ID=<program id>` в `.env.local`.
2. Расширить `assertMoneyConfig` (`src/lib/chain/addresses.ts`) fail-closed-проверкой адреса программы.
3. Реализовать ончейн-`gameAction` для escrow-task в `ChainDataProvider` (строить инструкции
   `fund/accept/markDone/claim*` кошельком, как `createDonation`) — следующий шаг G3a после деплоя.
4. Научить индексер наблюдать программу и писать `DONATION`/`REFUND`/`DISPUTE_*` в журнал (ADR 0015 §2).

## Безопасность (до мейннета — G3b)

- Аудит контракта обязателен (держит деньги).
- `resolver` — bounded-доверие ТОЛЬКО для devnet (выбор стороны спора). На мейннете заменить ончейн
  commit-reveal голосованием + решить мастер-переменную (юрисдикция/США), см. ADR 0017 § G3b.
- Рассмотреть u128-промежуток в расчёте комиссии (сейчас `overflow-checks = true` ловит переполнение
  паникой — безопасно, но u128 не упрётся на больших суммах).
