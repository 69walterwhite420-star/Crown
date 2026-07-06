/**
 * Disputes in the canister (M2, ADR 0021) — canonical wallet-signature messages: opening a dispute
 * and voting. An isomorphic module without web3.js.
 *
 * IMPORTANT: the strings must match Rust byte-for-byte (`canister/core/src/arbiter.rs`) —
 * paired pin tests: dispute-vote.test.ts ↔ arbiter.rs::canonical_messages_pinned.
 * Anti-replay: the escrow account address + realm + (for a vote) the choice — inside the signed text.
 */

export type DisputeVoteChoice = "completed" | "not_completed";

/** Opening a dispute: signed by the initiator (weight ≥ realm threshold is checked by the canister). */
export function buildOpenDisputeMessage(
  escrowAccount: string,
  channelId: string,
  by: string,
): string {
  return [
    "Standing: opening a dispute over a Crown-task.",
    "",
    "By signing, you dispute completion of the task. This costs no money,",
    "but a lost false dispute will deduct 50 points of your Reign.",
    "",
    `escrow: ${escrowAccount}`,
    `channel: ${channelId}`,
    `by: ${by}`,
    "v: 2",
  ].join("\n");
}

/** Vote: weight = a snapshot of the voter's Reign on the realm at the moment the dispute opened (canister). */
export function buildVoteMessage(
  escrowAccount: string,
  channelId: string,
  voter: string,
  choice: DisputeVoteChoice,
): string {
  return [
    "Standing: a vote in a dispute over a Crown-task.",
    "",
    "By signing, you vote with the weight of your Reign on this realm.",
    "",
    `escrow: ${escrowAccount}`,
    `channel: ${channelId}`,
    `voter: ${voter}`,
    `choice: ${choice}`,
    "v: 1",
  ].join("\n");
}

// ─────────── dispute view from the canister (response to GET /dispute, arbiter/http.rs::case_json) ───────────

export interface CanisterDisputeVote {
  voter: string;
  choice: DisputeVoteChoice;
  weightMicro: bigint;
  atMs: number;
}

export interface CanisterDisputeView {
  escrowAccount: string;
  channelId: string;
  escrowTaskId: string | null; // hex seed of the escrow PDA — the join key to the server task (task.escrowTaskId)
  status: string; // DISPUTED | RESOLVED (canister machine)
  openedBy: string | null;
  openedAtMs: number | null;
  votingEndsAtMs: number | null;
  quorumMicro: bigint;
  votes: CanisterDisputeVote[];
  tallyCompletedMicro: bigint;
  tallyNotCompletedMicro: bigint;
  markDisputedTx: string | null;
  resolveTx: string | null;
  lastSendError: string | null;
  verdict: { outcome: "to_streamer" | "to_donor"; reason: string; finalizedAtMs: number } | null;
}

/** Raw canister JSON → typed view (money/weights as strings → bigint). */
export function normalizeCanisterDispute(raw: {
  escrowAccount: string;
  channelId: string;
  escrowTaskId?: string | null;
  status: string;
  openedBy: string | null;
  openedAtMs: number | null;
  votingEndsAtMs: number | null;
  quorumMicro: string | null;
  votes: { voter: string; choice: string; weightMicro: string; atMs: number }[] | null;
  tally: { completedMicro: string; notCompletedMicro: string };
  markDisputedTx: string | null;
  resolveTx: string | null;
  lastSendError: string | null;
  verdict: { outcome: string; reason: string; finalizedAtMs: number } | null;
}): CanisterDisputeView {
  return {
    escrowAccount: raw.escrowAccount,
    channelId: raw.channelId,
    escrowTaskId: raw.escrowTaskId ?? null,
    status: raw.status,
    openedBy: raw.openedBy,
    openedAtMs: raw.openedAtMs,
    votingEndsAtMs: raw.votingEndsAtMs,
    quorumMicro: BigInt(raw.quorumMicro ?? 0),
    votes: (raw.votes ?? []).map((v) => ({
      voter: v.voter,
      choice: v.choice as DisputeVoteChoice,
      weightMicro: BigInt(v.weightMicro),
      atMs: v.atMs,
    })),
    tallyCompletedMicro: BigInt(raw.tally.completedMicro),
    tallyNotCompletedMicro: BigInt(raw.tally.notCompletedMicro),
    markDisputedTx: raw.markDisputedTx,
    resolveTx: raw.resolveTx,
    lastSendError: raw.lastSendError,
    verdict: raw.verdict
      ? {
          outcome: raw.verdict.outcome as "to_streamer" | "to_donor",
          reason: raw.verdict.reason,
          finalizedAtMs: raw.verdict.finalizedAtMs,
        }
      : null,
  };
}
