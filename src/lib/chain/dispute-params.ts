/**
 * Governance parameters for realm disputes (M1, ADR 0021) — an isomorphic module without web3.js.
 *
 * The storage canon is the ICP core canister (`canister/core/src/governance.rs`): writes only via the
 * realm owner's ed25519 signature over the canonical message built here, taking effect with a timelock.
 * IMPORTANT: `buildDisputeParamsMessage` must produce BYTE-FOR-BYTE the same string as Rust
 * (`governance.rs::build_params_message`) — a shared pin in the tests on both sides
 * (dispute-params.test.ts ↔ governance.rs::canonical_message_pinned). Change only via `v:`.
 */

/** Parameter values: money/points — integer micro (bigint), K — milli, windows — seconds. */
export interface DisputeParamsValues {
  /** Reign threshold for the right to OPEN a dispute (micro-points). */
  minReputationToDisputeMicro: bigint;
  /** Juror weight threshold (micro-points). */
  minWeightToVoteMicro: bigint;
  /** Turnout quorum — a fixed number of micro-points, set by the streamer (default 1 point). */
  quorumMicro: bigint;
  /** Window to "raise a dispute" from "Done", secs. */
  disputeWindowSecs: number;
  /** Voting window, secs. */
  votingWindowSecs: number;
  /** DEAD field (owner decision M2: there is no amount-based economics — the arbiter doesn't read it).
   * Kept for the stability of the signed message; remove only with a `v:` bump. */
  dMaxMicro: bigint;
  /** Reign reward to the initiator for a CONFIRMED dispute (micro-points). A realm parameter since v:3 — formerly
   *  a protocol constant (10 points). Changed by the owner's signature + timelock, like quorum/windows. */
  disputeWinBonusMicro: bigint;
  /** Reign penalty to the initiator for a LOST false dispute (micro-points, stored positive).
   *  A realm parameter since v:3 — formerly a constant (50). §4.5 holds: the protocol deducts by outcome, not the operator. */
  disputeLossPenaltyMicro: bigint;
}

/** State of a realm's parameters in the canister (response to /dispute-params). */
export interface DisputeParamsInfo {
  channelId: string;
  /** Owner FROM THE CHAIN (the activation payer in the canister ledger); null = realm not activated. */
  owner: string | null;
  /** Last accepted version (0 = no records yet). */
  version: number;
  /** true = the realm changed nothing, defaults apply. */
  isDefault: boolean;
  effective: DisputeParamsValues;
  pending: { params: DisputeParamsValues; effectiveAtMs: number; version: number } | null;
}

/** Canonical message to sign with the wallet. DO NOT CHANGE without a synchronous Rust edit and `v:`. */
export function buildDisputeParamsMessage(
  channelId: string,
  owner: string,
  version: number,
  p: DisputeParamsValues,
): string {
  return [
    "Standing: realm dispute parameters.",
    "",
    "By signing, you set the dispute rules for your realm.",
    "Changes take effect after the timelock — ongoing disputes play out under the previous rules.",
    "",
    `channel: ${channelId}`,
    `owner: ${owner}`,
    `version: ${version}`,
    `minReputationToDisputeMicro: ${p.minReputationToDisputeMicro}`,
    `minWeightToVoteMicro: ${p.minWeightToVoteMicro}`,
    `quorumMicro: ${p.quorumMicro}`,
    `disputeWindowSecs: ${p.disputeWindowSecs}`,
    `votingWindowSecs: ${p.votingWindowSecs}`,
    `dMaxMicro: ${p.dMaxMicro}`,
    `disputeWinBonusMicro: ${p.disputeWinBonusMicro}`,
    `disputeLossPenaltyMicro: ${p.disputeLossPenaltyMicro}`,
    "v: 3",
  ].join("\n");
}

/** JSON parameter fields from the canister (numbers or decimal strings — money as strings). */
interface RawParams {
  minReputationToDisputeMicro: number | string;
  minWeightToVoteMicro: number | string;
  quorumMicro: number | string;
  disputeWindowSecs: number | string;
  votingWindowSecs: number | string;
  dMaxMicro: number | string;
  disputeWinBonusMicro: number | string;
  disputeLossPenaltyMicro: number | string;
}

export interface RawDisputeParamsResponse {
  channelId: string;
  owner: string | null;
  version: number;
  isDefault: boolean;
  effective: RawParams;
  pending: { params: RawParams; effectiveAtNs: string; version: number } | null;
}

function normalizeValues(raw: RawParams): DisputeParamsValues {
  return {
    minReputationToDisputeMicro: BigInt(raw.minReputationToDisputeMicro),
    minWeightToVoteMicro: BigInt(raw.minWeightToVoteMicro),
    quorumMicro: BigInt(raw.quorumMicro),
    disputeWindowSecs: Number(raw.disputeWindowSecs),
    votingWindowSecs: Number(raw.votingWindowSecs),
    dMaxMicro: BigInt(raw.dMaxMicro),
    disputeWinBonusMicro: BigInt(raw.disputeWinBonusMicro),
    disputeLossPenaltyMicro: BigInt(raw.disputeLossPenaltyMicro),
  };
}

/** Canister response → typed state (ns → ms at the boundary). */
export function normalizeDisputeParams(raw: RawDisputeParamsResponse): DisputeParamsInfo {
  return {
    channelId: raw.channelId,
    owner: raw.owner,
    version: raw.version,
    isDefault: raw.isDefault,
    effective: normalizeValues(raw.effective),
    pending: raw.pending
      ? {
          params: normalizeValues(raw.pending.params),
          effectiveAtMs: Number(BigInt(raw.pending.effectiveAtNs) / 1_000_000n),
          version: raw.pending.version,
        }
      : null,
  };
}
