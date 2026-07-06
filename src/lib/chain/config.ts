import { PublicKey } from "@solana/web3.js";
import { DEVNET_USDC_MINT, TREASURY_OWNER } from "./addresses";

/**
 * On-chain config with PublicKey wrappers (Phase 3, yellow-paper §3.4). Network — devnet. String addresses/
 * constants live in ./addresses (no web3.js). Stack on web3.js v1 (wallet-adapter compatibility, ADR 0004).
 */
export * from "./addresses";

/** SPL Memo program. */
export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export const mintPubkey = () => new PublicKey(DEVNET_USDC_MINT);
export const treasuryPubkey = () => new PublicKey(TREASURY_OWNER);
