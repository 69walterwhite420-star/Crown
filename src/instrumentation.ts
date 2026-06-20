import { assertMoneyConfig } from "@/lib/chain/addresses";

/**
 * Next 15 startup-хук (запускается один раз при старте серверного инстанса). Fail-closed проверка
 * денежной конфигурации на mainnet (аудит C2, ADR 0009): в production без явных трежери/оператора/USDC-mint
 * (или с devnet-трежери / оператор=трежери) сервер НЕ стартует. Вне прода — no-op.
 */
export function register(): void {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    assertMoneyConfig();
  }
}
