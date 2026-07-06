/**
 * Data model of the "task-for-a-crown" mini-game (yellow-paper §7). Pure data —
 * no React and no IO. Money is stored as a DECIMAL STRING of micro-USDC (JSON-clean; bigint only at the boundary when
 * banking into the reputation ledger), so the game's opaque state slice (ADR 0016) serializes without codec tags.
 */

/** Task stage (stored). The terminal one is `RESOLVED` (+ `resolution`). Time "advances" the stages — see machine.ts. */
export type TaskStatus = "PENDING" | "ACCEPTED" | "DONE" | "DISPUTED" | "RESOLVED";

/** Where the money went in the end. */
export type TaskOutcome = "to_streamer" | "to_donor";

/** Why it resolved this way (for the UI and the ledger). */
export type ResolutionReason =
  | "rejected" // streamer rejected → to the donor
  | "expired" // not accepted within the window → to the donor
  | "canceled" // canceled within the grace window → to the donor
  | "no_show" // accepted, but didn't press "Done" in time → to the donor
  | "completed" // "Done", no dispute → to the streamer
  | "vote_completed" // vote "completed" → to the streamer
  | "vote_not_completed" // vote "not completed" → to the donor (100%)
  | "no_quorum" // quorum not reached → to the streamer (default)
  | "tie"; // tie by weight → to the streamer (presumption, spec §11)

export type VoteChoice = "completed" | "not_completed";

export interface TaskVote {
  voter: string; // address
  choice: VoteChoice;
  weight: number; // weight = reputation at the snapshot (computePointsAsOf at the dispute moment)
  at: string; // ISO
}

export interface TaskDispute {
  by: string; // initiator
  openedAt: string; // ISO — the weight-snapshot moment
  votingEndsAt: string; // ISO
  quorum: number; // required total weight (in reputation points)
  votes: TaskVote[];
}

export interface TaskResolution {
  outcome: TaskOutcome;
  reason: ResolutionReason;
  resolvedAt: string; // ISO
  claimed: boolean; // claim model (ADR 0015): the recipient hasn't taken the money yet
}

export interface EscrowTask {
  id: string;
  channelId: string;
  donor: string; // donor's address
  amount: string; // micro-USDC as a decimal string
  text: string; // task text (UGC; moderation — in create: classifyTaskText before funding, CR-5)
  createdAt: string; // ISO
  // Delivery deadline (press "Done"), counted from creation (= on-chain done_deadline). After it — a refund to the
  // donor (no-show). Set at createTask, not reset.
  executionDeadline: string; // ISO
  status: TaskStatus;

  // On-chain escrow (chain mode, G3a; ADR 0017). In mock/api it's empty — the money is mocked.
  escrowTaskId?: string; // hex of the 32-byte escrow-PDA seed = commitment SHA-256(nonce ‖ text) (CR-4)
  textNonce?: string; // CR-4: the text-commitment salt (public; needed for recomputation/verification by a third party)
  fundTx?: string; // signature of the escrow funding tx

  // ACCEPTED:
  graceUntil?: string; // ISO — the donor's cancel window

  // DONE:
  disputeWindowEndsAt?: string; // ISO — a dispute can be raised until this

  // DISPUTED:
  dispute?: TaskDispute;

  // RESOLVED:
  resolution?: TaskResolution;

  // Task-text moderation. The money/escrow doesn't depend on the text (§7 "money ≠ display"). The owner/author always
  // see the text; in the PUBLIC feed — only SHOWN. Empty = SHOWN (compatibility with old tasks).
  reports?: TaskReport[];
  textState?: "SHOWN" | "HELD" | "HIDDEN"; // HELD — in the moderation queue until "Show"; HIDDEN — hidden (reports/streamer)
  // Streamer "rejected" the task: we hide it from the feed/"Active" WITHOUT an on-chain tx and without an immediate refund.
  // The escrow stays and will return to the donor on its own by timer (no-show) — the streamer pays no gas/fee. Money/status untouched.
  hidden?: boolean;
  // Operator takedown (platform moderation): the text is pulled from publication FOR GOOD and overrides everything — the
  // streamer won't show it, the indexer's auto-reveal (ESC-19) won't bring it back. Not stored on the task, but COMPUTED in the
  // list/get queries from the operator override set (source of truth — the operator-actions log). This doesn't touch on-chain
  // money (§4.1/§4.2 non-custodial) — only content visibility.
  operatorBlocked?: boolean;
}

/** A viewer's report about a task's text (public UGC). Deduped by reporter, like reports on donation messages. */
export interface TaskReport {
  reporter: string;
  reason?: string;
  ts: string; // ISO
}

/** A reputation effect for banking into the ledger (ADR 0015). Money provenance — as a micro string. */
export interface RepEffect {
  address: string;
  type: "DONATION" | "DISPUTE_WON" | "DISPUTE_LOST";
  pointsDelta: number;
  amount?: string; // micro-USDC (for DONATION)
}

// ─────────── paginated view of a dispute's votes (the "Participants and votes" page) ───────────
// The type is shared by the server (game-bus `disputeVotes`) and the icp provider (a canister dispute flows
// into the same view) — the selection/pagination itself is a pure function, machine.disputeVotesView.

export interface DisputeVotesQuery {
  page?: number;
  pageSize?: number;
  side?: VoteChoice | null;
  sort?: "weight" | "recent";
  q?: string;
}

export interface DisputeVotesResult {
  found: boolean;
  task?: {
    id: string;
    status: TaskStatus;
    amount: string;
    text: string;
    donor: string;
    resolution: TaskResolution | null;
  };
  dispute?: {
    by: string;
    openedAt: string;
    votingEndsAt: string;
    quorum: number;
    tally: {
      completed: number;
      not: number;
      completedVotes: number;
      notVotes: number;
      total: number;
    };
  };
  votes: TaskVote[];
  total: number;
  page: number;
  pageSize: number;
}
