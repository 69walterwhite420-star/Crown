/**
 * The "task-for-a-crown" state machine — PURE logic (no IO/React), per spec §5/§6/§11. All functions are
 * deterministic: time arrives as the `nowMs` parameter, and transitions return a NEW object (immutably).
 *
 * Separation of concerns: the machine checks STATE and TIME; authorization (owner/donor/juror eligibility) and
 * computing the weight/quorum is done by the handler (game-bus, G1.3 part 2) — it has the channel config and the
 * ledger. Reputation effects (ADR 0015) are only COMPUTED by the machine; the handler banks them.
 */
import { pointsForAmount } from "@/lib/reputation";
import { GameBusError } from "../bus";
import type {
  DisputeVotesResult,
  EscrowTask,
  RepEffect,
  ResolutionReason,
  TaskDispute,
  TaskOutcome,
  TaskReport,
  TaskVote,
} from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ⚠️ TEMPORARY (on-chain-cycle testing): short windows so a task can run through in minutes. RETURN TO PROD WITH
// ONE CHANGE — `FAST_TEST_WINDOWS = false`. IMPORTANT: the on-chain constants (DISPUTE_WINDOW/VOTING_WINDOW/
// CANCEL_GRACE in anchor/programs/escrow-task/src/lib.rs) must match these — when reverting, revert them too
// + redeploy. There is NO separate "accept window" here or on-chain: all deadlines run from CREATION.
const FAST_TEST_WINDOWS = true;

/** Process windows (spec §5/§10). Starting defaults — calibrated on testnet (spec §16). */
export const WINDOWS = FAST_TEST_WINDOWS
  ? {
      grace: 1 * MIN,
      executionDefault: 2 * MIN,
      executionMin: 2 * MIN, // ESC-17: > grace, otherwise the mark_done window (after grace) degenerates
      executionMax: 90 * DAY,
      disputeWindow: 2 * MIN,
      voting: 2 * MIN,
    }
  : {
      grace: 2 * MIN, // the donor's cancel window after accept
      executionDefault: 24 * HOUR,
      // ESC-17: the minimum delivery deadline MUST exceed the grace (otherwise the mark_done window after grace is
      // empty/degenerate → a guaranteed no-show). We keep a noticeable margin over grace (2 min).
      executionMin: 5 * MIN,
      executionMax: 90 * DAY, // ceiling on the execution deadline — up to 3 months (the donor types the number by hand)
      disputeWindow: 12 * HOUR, // from "Done" — the window to raise a dispute
      voting: 24 * HOUR,
    };

/** Reputation change for a dispute (spec §8/§16: calibrated so a clawback is EV-negative). */
export const DISPUTE_WIN_BONUS = 10; // confirmed dispute (raised, community agreed)
export const DISPUTE_LOSS_PENALTY = 50; // lost dispute (penalty to the initiator)

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (isoStr: string) => Date.parse(isoStr);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ───────────────────────── transitions (actions) ─────────────────────────

export interface CreateTaskInput {
  id: string;
  channelId: string;
  donor: string;
  amount: string; // micro-USDC as a string
  text: string;
  textState?: "SHOWN" | "HELD" | "HIDDEN"; // text visibility in the public feed (the handler decides by textShowMode)
  executionMs?: number; // execution deadline proposed by the donor (within the window)
}

export function createTask(input: CreateTaskInput, nowMs: number): EscrowTask {
  // The DELIVERY deadline is set by the donor and counted FROM CREATION (= on-chain done_deadline from `fund`). "Accept"
  // is a free off-chain mark; there is no separate accept window and no deadline reset (a UX simplification, see the thread).
  // ESC-17: the lower bound of the delivery deadline MUST exceed the grace (parity with the on-chain require execution_window
  // > CANCEL_GRACE) — otherwise the mark_done window (after grace, ESC-13) is empty and the task always goes to no-show.
  const proposed = clamp(
    input.executionMs ?? WINDOWS.executionDefault,
    Math.max(WINDOWS.executionMin, WINDOWS.grace + 1),
    WINDOWS.executionMax,
  );
  const deliverBy = iso(nowMs + proposed);
  return {
    id: input.id,
    channelId: input.channelId,
    donor: input.donor,
    amount: input.amount,
    text: input.text,
    createdAt: iso(nowMs),
    executionDeadline: deliverBy, // delivery deadline from creation (= on-chain done_deadline)
    // The donor's cancel grace window — FROM CREATION (= on-chain accept_deadline = fund + CANCEL_GRACE), just like the
    // check in cancel/markDone. Set once at creation; accept does not reset it.
    graceUntil: iso(nowMs + WINDOWS.grace),
    status: "PENDING",
    textState: input.textState, // undefined = SHOWN (compatibility)
  };
}

export function accept(task: EscrowTask, nowMs: number): EscrowTask {
  if (task.status !== "PENDING")
    throw new GameBusError("NOT_PENDING", "This task is no longer awaiting a response.");
  if (nowMs > ms(task.executionDeadline))
    throw new GameBusError("ACCEPT_EXPIRED", "The delivery deadline has passed — the crown will return to the donor.");
  // ESC-19: accepting REVEALS the text (SHOWN). An on-chain `accept` is required before `mark_done`, and from the accept-tx
  // the indexer reveals the text even outside the UI — so "hid the text but took the money" is impossible (on-chain↔off-chain seam).
  return { ...task, status: "ACCEPTED", textState: "SHOWN" };
}

export function reject(task: EscrowTask, nowMs: number): EscrowTask {
  if (task.status !== "PENDING" && task.status !== "ACCEPTED")
    throw new GameBusError("NOT_OPEN", 'You can only reject before "Done".');
  return applyResolution(task, { outcome: "to_donor", reason: "rejected" }, nowMs);
}

export function cancel(task: EscrowTask, nowMs: number): EscrowTask {
  if (task.status !== "PENDING" && task.status !== "ACCEPTED")
    throw new GameBusError("NOT_OPEN", 'You can only cancel before "Done".');
  // Grace window from creation (matches the on-chain accept_deadline = fund + CANCEL_GRACE; audit #5) — so the
  // donor can't wipe out already-done work by canceling at an arbitrary moment.
  if (nowMs > ms(task.createdAt) + WINDOWS.grace)
    throw new GameBusError("GRACE_OVER", "The cancel window is closed.");
  return applyResolution(task, { outcome: "to_donor", reason: "canceled" }, nowMs);
}

export function markDone(task: EscrowTask, nowMs: number): EscrowTask {
  if (task.status !== "PENDING" && task.status !== "ACCEPTED")
    throw new GameBusError("NOT_OPEN", 'You can only mark "Done" before resolution.');
  // ESC-13: you can't submit during the donor's cancel grace window (matches the on-chain accept_deadline = fund + grace) —
  // otherwise the streamer front-runs "Done" right after fund and nullifies the donor's emergency cancel.
  if (nowMs <= ms(task.createdAt) + WINDOWS.grace)
    throw new GameBusError("GRACE_ACTIVE", "You can only submit after the donor's cancel grace window.");
  if (nowMs > ms(task.executionDeadline))
    throw new GameBusError("EXEC_OVER", "The delivery deadline has passed — the crown will return to the donor (no-show).");
  // There's no proof: for content creators the proof is the stream/VOD itself, which the community already monitors. "Done"
  // is just a declaration that opens the dispute window; if it wasn't done — the community raises a dispute.
  return {
    ...task,
    status: "DONE",
    disputeWindowEndsAt: iso(nowMs + WINDOWS.disputeWindow),
  };
}

export function raiseDispute(
  task: EscrowTask,
  by: string,
  quorum: number,
  nowMs: number,
): EscrowTask {
  if (task.status !== "DONE")
    throw new GameBusError("NOT_DONE", 'A dispute can only be raised after "Done".');
  if (nowMs > ms(task.disputeWindowEndsAt ?? task.createdAt))
    throw new GameBusError("DISPUTE_WINDOW_OVER", "The dispute window is closed.");
  const dispute: TaskDispute = {
    by,
    openedAt: iso(nowMs),
    votingEndsAt: iso(nowMs + WINDOWS.voting),
    quorum,
    votes: [],
  };
  return { ...task, status: "DISPUTED", dispute };
}

export function castVote(task: EscrowTask, vote: TaskVote, nowMs: number): EscrowTask {
  if (task.status !== "DISPUTED" || !task.dispute)
    throw new GameBusError("NOT_DISPUTED", "You can only vote in an active dispute.");
  if (nowMs > ms(task.dispute.votingEndsAt))
    throw new GameBusError("VOTING_OVER", "Voting has ended.");
  if (task.dispute.votes.some((v) => v.voter === vote.voter))
    throw new GameBusError("ALREADY_VOTED", "You have already voted in this dispute.");
  return { ...task, dispute: { ...task.dispute, votes: [...task.dispute.votes, vote] } };
}

// ───────────────────────── resolution (time + votes) ─────────────────────────

/** Voting outcome by weight. The quorum is in reputation points; a tie/no quorum → to the streamer (presumption §11). */
export function tally(d: TaskDispute): { outcome: TaskOutcome; reason: ResolutionReason } {
  let completed = 0;
  let not = 0;
  for (const v of d.votes) {
    if (v.choice === "completed") completed += v.weight;
    else not += v.weight;
  }
  if (completed + not < d.quorum) return { outcome: "to_streamer", reason: "no_quorum" };
  if (completed > not) return { outcome: "to_streamer", reason: "vote_completed" };
  if (not > completed) return { outcome: "to_donor", reason: "vote_not_completed" };
  return { outcome: "to_streamer", reason: "tie" };
}

/** The terminal outcome reached BY TIME (or at the end of voting). null — still too early. */
export function dueResolution(
  task: EscrowTask,
  nowMs: number,
): { outcome: TaskOutcome; reason: ResolutionReason } | null {
  switch (task.status) {
    case "PENDING":
      return nowMs > ms(task.executionDeadline) ? { outcome: "to_donor", reason: "expired" } : null;
    case "ACCEPTED":
      return nowMs > ms(task.executionDeadline) ? { outcome: "to_donor", reason: "no_show" } : null;
    case "DONE":
      return task.disputeWindowEndsAt && nowMs > ms(task.disputeWindowEndsAt)
        ? { outcome: "to_streamer", reason: "completed" }
        : null;
    case "DISPUTED":
      return task.dispute && nowMs > ms(task.dispute.votingEndsAt) ? tally(task.dispute) : null;
    default:
      return null;
  }
}

export function applyResolution(
  task: EscrowTask,
  res: { outcome: TaskOutcome; reason: ResolutionReason },
  nowMs: number,
): EscrowTask {
  return {
    ...task,
    status: "RESOLVED",
    resolution: {
      outcome: res.outcome,
      reason: res.reason,
      resolvedAt: iso(nowMs),
      claimed: false,
    },
  };
}

/**
 * Reputation effects on resolution (ADR 0015, spec §8):
 *  - money reached the streamer → the donor gets standing for the delivered crown (DONATION, +);
 *  - lost dispute → penalty to the initiator (DISPUTE_LOST, −);
 *  - confirmed dispute → bonus to the initiator (DISPUTE_WON, +).
 * A refund to the donor by itself grants no reputation (spec §8).
 */
export function repEffects(
  task: EscrowTask,
  res: { outcome: TaskOutcome; reason: ResolutionReason },
): RepEffect[] {
  const out: RepEffect[] = [];
  if (res.outcome === "to_streamer") {
    out.push({
      address: task.donor,
      type: "DONATION",
      pointsDelta: pointsForAmount(BigInt(task.amount)),
      amount: task.amount,
    });
  }
  if (task.dispute) {
    if (res.reason === "vote_completed")
      out.push({
        address: task.dispute.by,
        type: "DISPUTE_LOST",
        pointsDelta: -DISPUTE_LOSS_PENALTY,
      });
    if (res.reason === "vote_not_completed")
      out.push({ address: task.dispute.by, type: "DISPUTE_WON", pointsDelta: DISPUTE_WIN_BONUS });
  }
  return out;
}

/**
 * Paginated view of a dispute's votes (the "Participants and votes" page): an aggregate over ALL votes +
 * filter by side, search by address, sorting, pagination. A pure function: called by both the server handler
 * (game-bus `disputeVotes`) and the icp provider (a canister dispute merged into the task by the same view) —
 * one view, two sources. The task arrives already redacted (§4.6).
 */
export function disputeVotesView(task: EscrowTask, payload: unknown): DisputeVotesResult {
  const notFound = { found: false, votes: [], total: 0, page: 0, pageSize: 50 };
  const d = task.dispute;
  if (!d) return notFound;
  const p = (payload ?? {}) as {
    page?: unknown;
    pageSize?: unknown;
    side?: unknown;
    sort?: unknown;
    q?: unknown;
  };

  let completed = 0;
  let not = 0;
  let completedVotes = 0;
  let notVotes = 0;
  for (const v of d.votes) {
    if (v.choice === "completed") {
      completed += v.weight;
      completedVotes += 1;
    } else {
      not += v.weight;
      notVotes += 1;
    }
  }

  const q = typeof p.q === "string" ? p.q.trim().toLowerCase() : "";
  const side = p.side === "completed" || p.side === "not_completed" ? p.side : null;
  const sort = p.sort === "recent" ? "recent" : "weight";
  const filtered = d.votes
    .filter((v) => (!side || v.choice === side) && (!q || v.voter.toLowerCase().includes(q)))
    .sort((a, b) => (sort === "recent" ? (a.at < b.at ? 1 : -1) : b.weight - a.weight));

  const total = filtered.length;
  const page = Math.max(0, Math.floor(Number(p.page) || 0));
  const pageSize = Math.min(200, Math.max(1, Math.floor(Number(p.pageSize) || 50)));
  const votes = filtered.slice(page * pageSize, page * pageSize + pageSize);

  return {
    found: true,
    task: {
      id: task.id,
      status: task.status,
      amount: task.amount,
      text: task.text,
      donor: task.donor,
      resolution: task.resolution ?? null,
    },
    dispute: {
      by: d.by,
      openedAt: d.openedAt,
      votingEndsAt: d.votingEndsAt,
      quorum: d.quorum,
      tally: { completed, not, completedVotes, notVotes, total: completed + not },
    },
    votes,
    total,
    page,
    pageSize,
  };
}

// ───────────────────────── claim (ADR 0015) ─────────────────────────

/** Take the money out of escrow. Recipient = the streamer (to_streamer) or the donor (to_donor); only them, once. */
export function claim(
  task: EscrowTask,
  by: string,
  streamerAddress: string,
  nowMs: number,
): EscrowTask {
  void nowMs; // in the claim model time doesn't move state, but we keep a uniform transition signature
  if (task.status !== "RESOLVED" || !task.resolution)
    throw new GameBusError("NOT_RESOLVED", "There's nothing to claim yet — the task isn't resolved.");
  if (task.resolution.claimed) throw new GameBusError("ALREADY_CLAIMED", "Already claimed.");
  const winner = task.resolution.outcome === "to_streamer" ? streamerAddress : task.donor;
  if (by !== winner) throw new GameBusError("NOT_WINNER", "Only the recipient can claim.");
  return { ...task, resolution: { ...task.resolution, claimed: true } };
}

// ───────────────────────── reports on task text ─────────────────────────

/** Threshold for auto-hiding a task's text by reports (like donation messages, mock-provider). */
export const REPORT_HIDE_THRESHOLD = 3;
const REASON_MAX = 500;

/**
 * A viewer's report on a task's text. Deduped by reporter; you can't report your own task. On reaching the
 * threshold the text is auto-hidden (textState=HIDDEN) — money/escrow is NOT touched (§7 "hiding text ≠ money").
 */
export function report(
  task: EscrowTask,
  reporter: string,
  reason: string | undefined,
  nowMs: number,
): EscrowTask {
  if (reporter === task.donor)
    throw new GameBusError("SELF_REPORT", "You can't report your own task.");
  const reports = task.reports ?? [];
  if (reports.some((r) => r.reporter === reporter))
    throw new GameBusError("ALREADY_REPORTED", "You've already reported this task.");
  const next: TaskReport[] = [
    ...reports,
    { reporter, reason: reason?.slice(0, REASON_MAX), ts: iso(nowMs) },
  ];
  // Report threshold → auto-hide the text, BUT only BEFORE acceptance (PENDING): while not a cent can go to the
  // streamer, muting disputed text is safe (the escrow returns to the donor). After accept the money MAY go to the
  // streamer, so the text must stay visible (ESC-19) — otherwise a crook, via self-made reports (sockpuppets), hides
  // the task and quietly takes it. Post-accept reports still accumulate (a signal to the streamer/operator) but don't
  // mute the text; the last resort for illegal content on a paid task is an operator takedown + ban, not a quiet hide.
  const autoHide = task.status === "PENDING" && next.length >= REPORT_HIDE_THRESHOLD;
  return {
    ...task,
    reports: next,
    textState: autoHide ? "HIDDEN" : task.textState,
  };
}

/** The streamer shows/hides a task's text in the public feed (publication moderation; money/escrow — §7). */
export function setTextState(task: EscrowTask, state: "SHOWN" | "HIDDEN"): EscrowTask {
  return { ...task, textState: state };
}

/**
 * The streamer "rejects" a task: we hide it from the frontend WITHOUT an on-chain tx and without an immediate resolve — the
 * escrow stays and returns to the donor on its own by timer (no-show/expired). Money/status untouched; only for an unfinished task.
 */
export function hide(task: EscrowTask): EscrowTask {
  // "Reject" is only legitimate BEFORE acceptance: while not a cent can go to the streamer, removing the task from the
  // feed is safe (the escrow returns to the donor by timer). After accept the money MAY go to the streamer — hiding the
  // task from the feed is not allowed, otherwise the community won't see it and won't dispute it (ESC-19: money ⟹ task visible).
  if (task.status !== "PENDING")
    throw new GameBusError("NOT_OPEN", "The task is already accepted — it can't be rejected (the outcome is decided by the timer or a dispute).");
  return { ...task, hidden: true };
}

/** Whether a task's text is visible in the PUBLIC feed (ignoring the viewer's role). Empty = SHOWN (compatibility).
 * An operator takedown (operatorBlocked) overrides everything — text pulled by the operator is never public. */
export function isTextPublic(task: EscrowTask): boolean {
  return !task.operatorBlocked && (task.textState ?? "SHOWN") === "SHOWN";
}
