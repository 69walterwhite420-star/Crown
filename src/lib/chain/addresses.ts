/**
 * On-chain addresses and constants as STRINGS (no web3.js), so the server store can import them without
 * dragging the Solana stack into the mock/api bundle. PublicKey wrappers and the Memo program live in config.ts.
 */
export const DEVNET_RPC = process.env.NEXT_PUBLIC_DEVNET_RPC ?? "https://api.devnet.solana.com";

/** Cluster for explorer links — derived from the RPC endpoint (devnet by default). */
export const EXPLORER_CLUSTER = DEVNET_RPC.includes("devnet")
  ? "devnet"
  : DEVNET_RPC.includes("testnet")
    ? "testnet"
    : "mainnet-beta";

/** Link to a transaction in Solana Explorer (with the right cluster). A string — no web3.js, imported from UI. */
export function explorerTxUrl(signature: string): string {
  const url = `https://explorer.solana.com/tx/${signature}`;
  return EXPLORER_CLUSTER === "mainnet-beta" ? url : `${url}?cluster=${EXPLORER_CLUSTER}`;
}

/** Link to an address (account) in Solana Explorer — for "open the realm's payout in the explorer". */
export function explorerAddressUrl(address: string): string {
  const url = `https://explorer.solana.com/address/${address}`;
  return EXPLORER_CLUSTER === "mainnet-beta" ? url : `${url}?cluster=${EXPLORER_CLUSTER}`;
}

export const USDC_DECIMALS = 6;
export const FEE_BPS = 300; // 3%

/**
 * Integer split of a Crown amount: fee = FEE_BPS, net = remainder. THE single source of truth for the rate
 * (web3-free, so it's called from mock/api, from the UI, and from the chain path) — don't duplicate `*3n/100n` inline.
 */
export function splitAmount(amountMicro: bigint): { fee: bigint; net: bigint } {
  const fee = (amountMicro * BigInt(FEE_BPS)) / 10_000n;
  return { fee, net: amountMicro - fee };
}

/** One-time realm activation fee (~$2 to the treasury), an anti-flood anchor (yellow-paper §3.4). */
const ACTIVATION_FEE_USDC = 2;
export const ACTIVATION_FEE_MICRO = BigInt(ACTIVATION_FEE_USDC) * 1_000_000n;

/** Single source of truth for the prod gate (re-exported from @/server/runtime). */
export const IS_PROD = process.env.NODE_ENV === "production";

/** icp mode (M1, ADR 0021): chain + the canonical Reign READ source — the ICP core canister (IcpDataProvider). */
export const IS_ICP = process.env.NEXT_PUBLIC_DATA_SOURCE === "icp";

/** Chain mode — a single client flag (like IS_PROD), don't duplicate inline.
 * `icp` is a superset of chain (wallet/crowns/escrow are the same), so it enables all chain UI gates. */
export const IS_CHAIN = process.env.NEXT_PUBLIC_DATA_SOURCE === "chain" || IS_ICP;

/** Base of the core canister's HTTP export (raw domain; local stand — see the "ICP Canisters" runbook). */
export const ICP_CANISTER_URL = (process.env.NEXT_PUBLIC_ICP_CANISTER_URL ?? "").replace(/\/$/, "");

/** localStorage key for the SIWS token (written by the chain provider, read by /dev/db). One source — don't duplicate. */
export const SIWS_STORAGE_KEY = "standing.siws.v1";

// Known devnet defaults (treasury address + Circle devnet USDC). Their origin/secret is public
// (.treasury-devnet.json, faucet), so on mainnet they are FORBIDDEN: using the devnet treasury in prod means
// sending the 3% fee to an address whose private key sits in a plaintext file. In prod the default is NOT applied —
// values must come from env, otherwise the money path fails (fail-closed, ADR 0009 / audit C2).
const DEVNET_TREASURY = "9tSWouwVrPahnnLW4AMQcNn53Uk5okFEdduo1M3Gtrpe";
const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
/** The devnet default applies only outside prod; in prod → "" (env required). */
const devnetOnly = (v: string): string => (IS_PROD ? "" : v);

/** Circle devnet USDC (faucet.circle.com). On mainnet set the mainnet USDC mint via env. */
export const DEVNET_USDC_MINT = process.env.NEXT_PUBLIC_DEVNET_USDC_MINT ?? devnetOnly(DEVNET_USDC);

/** Treasury (owner) — receives 3%. Devnet default is gitignored in .treasury-devnet.json; in prod — env. */
export const TREASURY_OWNER = process.env.NEXT_PUBLIC_TREASURY_OWNER ?? devnetOnly(DEVNET_TREASURY);

/** Operator address (/ops). Outside prod a handy default = treasury; in prod it is NOT inherited (single-key risk). */
export const OPERATOR_ADDRESS =
  process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ?? devnetOnly(TREASURY_OWNER);

// — Escrow program for the Crown-task (game, G3a; ADR 0017). On devnet — the deployed id; in prod env. —
const DEVNET_ESCROW_PROGRAM = "GPP2BCNMp8peLh3uySuEqPb2gWanr4xw5Lf3X7Kx7GU4";
/** Program id of the escrow program. On mainnet set a fresh deployed id via env. */
export const ESCROW_PROGRAM_ID =
  process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID ?? devnetOnly(DEVNET_ESCROW_PROGRAM);
// M2 (ADR 0021): ESCROW_RESOLVER removed — the resolver of new escrows is baked into the program
// (the core canister's threshold address), it executes verdicts itself; the env var no longer exists.

/**
 * Fail-closed validation of the money configuration on mainnet (audit C2). Outside prod — no-op (devnet defaults ok).
 * In prod it requires explicit treasury/operator/USDC mint, forbids the devnet treasury and operator == treasury
 * (single-key risk, ADR 0006). Called at server start (instrumentation) and on the money path (ingest).
 */
export function assertMoneyConfig(): void {
  if (!IS_PROD) return;
  const missing: string[] = [];
  if (!TREASURY_OWNER) missing.push("NEXT_PUBLIC_TREASURY_OWNER");
  if (!OPERATOR_ADDRESS) missing.push("NEXT_PUBLIC_OPERATOR_ADDRESS");
  if (!DEVNET_USDC_MINT) missing.push("NEXT_PUBLIC_DEVNET_USDC_MINT (USDC mint)");
  if (missing.length > 0) {
    throw new Error(
      `[C2] Required money variables are not set in production: ${missing.join(", ")}. ` +
        "Devnet defaults are forbidden in prod (the treasury key is in plaintext). Set env before mainnet.",
    );
  }
  if (TREASURY_OWNER === DEVNET_TREASURY) {
    throw new Error(
      "[C2] The DEVNET treasury is set on mainnet (key in plaintext). Generate a fresh mainnet key.",
    );
  }
  if (TREASURY_OWNER === OPERATOR_ADDRESS) {
    throw new Error(
      "[C2] OPERATOR_ADDRESS == TREASURY_OWNER in production — separate the roles (single-key risk, ADR 0006).",
    );
  }
}
