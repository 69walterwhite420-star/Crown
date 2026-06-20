/**
 * Ончейн-адреса и константы СТРОКАМИ (без web3.js), чтобы их мог импортировать серверный стор, не таща
 * Solana-стек в bundle mock/api. PublicKey-обёртки и Memo-программа — в config.ts.
 */
export const DEVNET_RPC = process.env.NEXT_PUBLIC_DEVNET_RPC ?? "https://api.devnet.solana.com";

export const USDC_DECIMALS = 6;
export const FEE_BPS = 300; // 3%

export const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Circle devnet USDC (официальный). Пополняется через faucet.circle.com. */
export const DEVNET_USDC_MINT =
  process.env.NEXT_PUBLIC_DEVNET_USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

/** Трежери (владелец) — получает 3%. Сгенерирован; секрет в .treasury-devnet.json (gitignored). */
export const TREASURY_OWNER =
  process.env.NEXT_PUBLIC_TREASURY_OWNER ?? "9tSWouwVrPahnnLW4AMQcNn53Uk5okFEdduo1M3Gtrpe";

/** Адрес оператора (доступ к /ops). По умолчанию — трежери; задай свой адрес через ENV. */
export const OPERATOR_ADDRESS = process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ?? TREASURY_OWNER;
