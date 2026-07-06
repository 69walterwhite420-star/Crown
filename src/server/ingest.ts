import { getAssociatedTokenAddress } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  ACTIVATION_FEE_MICRO,
  assertMoneyConfig,
  DEVNET_RPC,
  mintPubkey,
  treasuryPubkey,
} from "@/lib/chain/config";
import { verifyPayoutAttestation } from "@/lib/chain/attestation";
import { extractActivation, extractDonation } from "@/lib/chain/indexer";
import { hashContent } from "@/lib/data/moderation";
import { CHAIN_MODE } from "@/server/runtime";
import type { MockDataProvider } from "@/lib/data/mock-provider";

/**
 * Trusted intake of an on-chain Crown by signature: the server ITSELF fetches the transaction from devnet, validates the
 * 97/3 + memo pair, checks that the 97% leg went to the realm's payout-ATA (trustless — it does not trust the client), and
 * idempotently records the Crown into the store. Called from RPC (the client after sending) and from the indexer service.
 * Server-only module (web3.js does not end up in the client mock/api bundle).
 */
export async function ingestSignature(
  store: MockDataProvider,
  signature: string,
  text?: string,
): Promise<{ ok: boolean; pending?: boolean; reason?: string; points?: number }> {
  assertMoneyConfig(); // fail-closed: on mainnet, without explicit money configuration we do not accept the Crown (C2)
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const mint = mintPubkey();
  const treasuryAta = await getAssociatedTokenAddress(mint, treasuryPubkey());

  // M2: in chain mode the credit waits for "finalized" (anti-reorg). Finalization happens ~15-30s LATER than
  // the client's "confirmed" → the tx may not be visible yet. This is NOT an error: we return pending, the client retries
  // (otherwise the money left but there's no credit). null AFTER the fetch = a genuinely invalid tx — we don't retry.
  const commitment = CHAIN_MODE ? "finalized" : "confirmed";
  const tx = await connection.getParsedTransaction(signature, {
    commitment,
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) {
    return { ok: false, pending: true, reason: "transaction not yet confirmed at the required level — we'll retry" };
  }
  const indexed = extractDonation(tx, signature, { mint, treasuryAta });
  if (!indexed) return { ok: false, reason: "invalid Crown transaction (no 97/3 + memo pair)" };

  const channelId = indexed.memo.c;
  const channel = store.__getChannelById(channelId);
  if (!channel) return { ok: false, reason: `realm ${channelId} not found` };

  // Trustless check: the 97% leg must go exactly to the realm's payout-ATA.
  const expectedStreamerAta = (
    await getAssociatedTokenAddress(mint, new PublicKey(channel.payoutAddress))
  ).toBase58();
  if (indexed.streamerAta !== expectedStreamerAta) {
    return { ok: false, reason: "the 97% leg went somewhere other than the realm's payout" };
  }

  // H1 (a second line after the client-side check in chain-provider): we credit the Crown only to a realm whose
  // payout is fixed by the owner's ed25519 signature. Swapping the payout in the DB without the owner's key yields an invalid
  // signature → no credit (the money in that case went where the donor actually signed — point 1 is held by the client).
  if (
    CHAIN_MODE &&
    (!channel.payoutAttestation ||
      !verifyPayoutAttestation(channel.ownerAddress, channel.payoutAddress, channel.payoutAttestation))
  ) {
    return { ok: false, reason: "the realm's payout is not confirmed by the owner's signature (attestPayout)" };
  }

  const cfg = await store.getChannelConfig(channelId);
  // B7: below the realm's minimum we do not accept the Crown (parity with off-chain createDonation — anti-spam). The money
  // is real, but we keep the spam-threshold policy identical on both paths.
  if (indexed.amountMicro < cfg.minDonation) {
    return { ok: false, reason: "the Crown amount is below the realm's minimum" };
  }
  // Trustless text binding: memo.m carries contentHash(text). We accept the text ONLY if its hash matched
  // the on-chain memo (the donor signed exactly it), the length is within the realm's limit (R5/ADR 0012) AND the amount ≥
  // minDonationWithText (as off-chain — text requires a threshold). Otherwise we ignore the text — money/Reign do not depend on it.
  const textHash = text ? await hashContent(text) : null;
  const verifiedText =
    text &&
    text.length <= cfg.messageMaxLen &&
    indexed.amountMicro >= cfg.minDonationWithText &&
    indexed.memo.m &&
    textHash === indexed.memo.m
      ? text
      : undefined;

  const res = await store.recordDonationFromChain({
    signature,
    donor: indexed.donor,
    channelId,
    amountMicro: indexed.amountMicro,
    feeMicro: indexed.feeMicro,
    netMicro: indexed.netMicro,
    text: verifiedText,
  });
  if (!res) return { ok: false, reason: "already accepted or the realm is missing" };
  return { ok: true, points: res.standing.points };
}

/**
 * Trusted intake of an on-chain activation fee by signature: the server itself fetches the tx, checks the transfer
 * payer→treasuryATA ≥ ACTIVATION_FEE and the memo `{act}`, verifies payer === the realm's owner (trustless — it does not
 * trust the client) and idempotently moves the realm to ACTIVE. The fee money goes to the operator, not a refund (§4.1).
 */
export async function ingestActivation(
  store: MockDataProvider,
  signature: string,
): Promise<{ ok: boolean; pending?: boolean; reason?: string }> {
  assertMoneyConfig(); // fail-closed: on mainnet, without money configuration we do not accept the fee (C2)
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const mint = mintPubkey();
  const treasuryAta = await getAssociatedTokenAddress(mint, treasuryPubkey());

  // M2: see ingestSignature — finalized in chain mode. The tx is not visible right after client-confirmed → pending
  // (the client retries), otherwise the fee is paid but the realm is not activated (this was exactly the bug).
  const commitment = CHAIN_MODE ? "finalized" : "confirmed";
  const tx = await connection.getParsedTransaction(signature, {
    commitment,
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) {
    return { ok: false, pending: true, reason: "the activation transaction is not finalized yet — we'll retry" };
  }
  const indexed = extractActivation(tx, signature, { mint, treasuryAta });
  if (!indexed) return { ok: false, reason: "invalid activation transaction (no transfer + memo {act})" };

  const channel = store.__getChannelById(indexed.channelId);
  if (!channel) return { ok: false, reason: `realm ${indexed.channelId} not found` };
  if (indexed.payer !== channel.ownerAddress) {
    return { ok: false, reason: "the fee was paid by someone other than the realm's owner" };
  }
  if (indexed.amountMicro < ACTIVATION_FEE_MICRO) {
    return { ok: false, reason: "the activation fee amount is below the required one" };
  }

  store.activateFromChain(indexed.channelId);
  return { ok: true };
}
