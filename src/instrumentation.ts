import { assertMoneyConfig } from "@/lib/chain/addresses";

/**
 * Next 15 startup hook (runs once when the server instance boots). Fail-closed check of the
 * money configuration on mainnet (audit C2, ADR 0009): in production, without explicit treasury/operator/USDC-mint
 * (or with a devnet treasury / operator=treasury) the server does NOT start. Outside production — no-op.
 */
export function register(): void {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    assertMoneyConfig();
  }
}
