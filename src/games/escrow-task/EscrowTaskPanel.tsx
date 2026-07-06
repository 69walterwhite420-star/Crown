"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Amount, FeeSplit } from "@/components/domain/amount";
import { ModerationMenu } from "@/components/domain/moderation-menu";
import { ReportDialog } from "@/components/domain/report-dialog";
import { StandingHeadline } from "@/components/domain/standing";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { ExternalLinkIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { explorerTxUrl } from "@/lib/chain/addresses";
import type { CanisterDisputeView } from "@/lib/chain/dispute-vote";
import { useChannelConfig, useDisputeParams, useSession, useStanding } from "@/lib/data/hooks";
import { pointsForAmount } from "@/lib/reputation";
import { collapseWhitespace, formatPoints, shortAddress, timeAgo, toMicro } from "@/lib/utils";
import { useCanisterDispute, useEscrowAction, useEscrowTasks } from "./hooks";
import { dueResolution, isTextPublic, WINDOWS } from "./machine";
import type { EscrowTask, TaskDispute } from "./types";

// The same amount presets as a regular crown (the crown widget) — a unified design.
const PRESETS = [5, 10, 25, 100];

// The execution deadline is typed in by the donor (number + unit); bounds — from WINDOWS (executionMin..executionMax).
const H = 3_600_000;
const MIN = H / 60;
const DAY = 24 * H;
const UNIT_MS: Record<"m" | "h" | "d", number> = { m: MIN, h: H, d: DAY };

/** A live timestamp: ticks once a second → the card's timers run in real time. */
function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Countdown to iso: "M:SS" by the second (for short windows), h/d — for long ones. `now` is live. */
function until(iso: string, now: number): string {
  const left = Date.parse(iso) - now;
  if (left <= 0) return "deadline passed";
  const s = Math.floor(left / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m left`;
  return `${m}:${sec.toString().padStart(2, "0")} left`;
}

/** Which deadline is ticking now (by stage) — a live caption for the card. */
function deadlineLabel(task: EscrowTask, now: number): string | null {
  switch (task.status) {
    case "PENDING":
      return `Submit by · ${until(task.executionDeadline, now)}`;
    case "ACCEPTED":
      return `Complete by · ${until(task.executionDeadline, now)}`;
    case "DONE":
      return task.disputeWindowEndsAt
        ? `Dispute by · ${until(task.disputeWindowEndsAt, now)}`
        : null;
    case "DISPUTED":
      return task.dispute ? `Voting · ${until(task.dispute.votingEndsAt, now)}` : null;
    default:
      return null;
  }
}

/**
 * The "task-for-a-crown" mini-game UI, two surfaces (ADR 0016 / redesign of the realm's games section):
 *  - EscrowTaskRail — the RIGHT rail: the action (create a task-for-a-crown);
 *  - EscrowTaskHub  — the LEFT: rules + "why it's fair" + active tasks (monitoring, disputes).
 * Data — via typed hooks (game-bus). Money in chain mode — a real on-chain escrow (G3a).
 */

interface GameProps {
  channelId: string;
  ownerAddress: string;
  handle: string;
}

const STATUS_LABEL: Record<EscrowTask["status"], string> = {
  PENDING: "Awaiting streamer",
  ACCEPTED: "In progress",
  DONE: "Dispute window",
  DISPUTED: "Dispute voting",
  RESOLVED: "Completed",
};
const outcomeLabel = (o: "to_streamer" | "to_donor") =>
  o === "to_streamer" ? "to streamer" : "refund to donor";

type Run = (op: string, payload?: unknown, okMsg?: string, onDone?: () => void) => void;

function useRun(channelId: string): { run: Run; pending: boolean } {
  const action = useEscrowAction(channelId);
  const run: Run = (op, payload, okMsg, onDone) =>
    action.mutate(
      { op, payload },
      {
        onSuccess: () => {
          if (okMsg) toast({ variant: "success", title: okMsg });
          onDone?.(); // e.g. close the confirm dialog and clear the form — only on success
        },
        onError: (e) =>
          toast({
            variant: "error",
            title: "Something went wrong",
            description: e instanceof Error ? e.message : String(e),
          }),
      },
    );
  return { run, pending: action.isPending };
}

// ───────────────────────── right rail: action ─────────────────────────

export function EscrowTaskRail({ channelId }: GameProps) {
  const viewer = useSession().data?.address ?? null;
  const config = useChannelConfig(channelId).data;
  const standingQ = useStanding(channelId, viewer);
  const { run, pending } = useRun(channelId);
  const [amount, setAmount] = useState("");
  const [text, setText] = useState("");
  // The execution deadline is set by the donor by hand: number + unit (hours/days). Default — 1 day.
  const [dlValue, setDlValue] = useState("1");
  const [dlUnit, setDlUnit] = useState<"m" | "h" | "d">("d");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const num = Number(amount);
  const amountValid = amount !== "" && Number.isFinite(num) && num > 0;
  const gain = amountValid ? pointsForAmount(toMicro(num)) : 0; // preview of the points gain
  // The realm's minimum for a task = the larger of minDonation/minDonationWithText (a task is a crown with text;
  // the same computation on the server in create → BELOW_MIN). We validate before signing — don't burn gas on a rejection.
  const minTaskMicro = config
    ? config.minDonationWithText > config.minDonation
      ? config.minDonationWithText
      : config.minDonation
    : null;
  const belowMin = amountValid && minTaskMicro !== null && toMicro(num) < minTaskMicro;
  const amountError = belowMin
    ? `The realm's minimum for tasks — ${Number(minTaskMicro) / 1_000_000} USDC`
    : undefined;

  // §10 threshold: the right to submit a task. We gate the form ahead of time — otherwise the donor learns of the
  // rejection only after typing the text (the server and chain preflight would cut it off anyway — this is an honest early signal).
  const minRep = config?.minReputationToTask ?? 0;
  const lowRep = minRep > 0 && (standingQ.data?.points ?? 0) < minRep;

  const dlNum = Number(dlValue);
  const deadlineMs = dlNum * UNIT_MS[dlUnit];
  const deadlineValid =
    dlValue !== "" &&
    Number.isInteger(dlNum) &&
    deadlineMs >= WINDOWS.executionMin &&
    deadlineMs <= WINDOWS.executionMax;
  // The floor comes from WINDOWS.executionMin (ESC-17: > grace), so the hint doesn't diverge from validation:
  // fast-test = 2 min, prod = 5 min. Ceiling executionMax = 90 days ≈ 3 months.
  const deadlineError =
    dlValue !== "" && !deadlineValid
      ? `Deadline: from ${Math.round(WINDOWS.executionMin / MIN)} minutes to 3 months`
      : undefined;
  // A long deadline = a long freeze: if the streamer ignores it, the refund only comes AFTER the delivery deadline
  // (escrow, no-show/expired) — there's no separate on-chain 72h accept window. We warn from 7 days (the v1.1 corridor).
  const longDeadline = deadlineValid && deadlineMs > 7 * DAY;
  const valid = amountValid && !belowMin && text.trim().length > 0 && deadlineValid && !lowRep;

  function confirmCreate() {
    if (!valid) return;
    run(
      "create",
      { amount: toMicro(num).toString(), text: text.trim(), executionMs: deadlineMs },
      "Task created",
      () => {
        // clear and close ONLY on success — if the signature was canceled → the form and dialog stay put
        setConfirmOpen(false);
        setAmount("");
        setText("");
      },
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-[var(--bg)] p-4">
      {!viewer ? (
        <>
          <h3 className="text-h3 text-fg">Task for a Crown</h3>
          <p className="text-small text-fg-muted">Connect your wallet to create a task.</p>
        </>
      ) : (
        <>
          {/* The same standing card as a regular crown: a live preview of the points gain. */}
          <StandingHeadline
            standing={standingQ.data}
            tiers={config?.tiers ?? []}
            gain={gain}
            loading={standingQ.isLoading}
          />

          <div className="border-t border-border" />

          <h3 className="text-h3 text-fg">Task for a Crown</h3>

          <div className="flex flex-col gap-2">
            <Input
              label="Amount, USDC"
              mono
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(",", "."))}
              error={amountError}
              className="bg-[var(--bg)]"
            />
            <div className="grid grid-cols-4 gap-2">
              {PRESETS.map((p) => (
                <Button
                  key={p}
                  variant="secondary"
                  size="sm"
                  className="w-full bg-[var(--bg)]"
                  onClick={() => setAmount(String(p))}
                >
                  ${p}
                </Button>
              ))}
            </div>
          </div>

          <Textarea
            label="Task"
            placeholder="What should the streamer do…"
            maxLength={config?.messageMaxLen ?? 280}
            showCount
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="bg-[var(--bg)]"
          />
          {lowRep ? (
            <p className="text-small text-fg-muted">
              Tasks in this realm start at {formatPoints(minRep)} Reign points (you have{" "}
              {formatPoints(standingQ.data?.points ?? 0)}). Reign is earned with regular crowns.
            </p>
          ) : null}

          <div className="flex flex-col gap-1">
            <span className="text-small text-fg-muted">Execution deadline</span>
            <div className="flex items-start gap-2">
              <Input
                mono
                inputMode="numeric"
                placeholder="1"
                value={dlValue}
                onChange={(e) => setDlValue(e.target.value.replace(/[^\d]/g, ""))}
                error={deadlineError}
                className="flex-1 bg-[var(--bg)]"
              />
              <Select
                value={dlUnit}
                onChange={(e) => setDlUnit(e.target.value as "m" | "h" | "d")}
                aria-label="Deadline unit"
                className="w-28 bg-[var(--bg)]"
              >
                <option value="m">minutes</option>
                <option value="h">hours</option>
                <option value="d">days</option>
              </Select>
            </div>
            {longDeadline ? (
              <p className="text-small text-warn">
                A long deadline — a long freeze: if the streamer simply ignores the task, the money
                will sit in escrow for up to {Math.round(deadlineMs / DAY)} days and return only
                after the deadline. You can only cancel in the first ~{Math.round(WINDOWS.grace / MIN)} min
                after creation.
              </p>
            ) : null}
          </div>

          <Button
            variant="secondary"
            disabled={!valid || pending}
            onClick={() => setConfirmOpen(true)}
            className="border-border-strong bg-[var(--bg)] hover:bg-surface-raised"
          >
            Create task
          </Button>

          {/* Confirmation with a breakdown — like a regular crown (donate.tsx), but the copy is honest for
              escrow: the money is NOT final to the streamer immediately; on a no-show it returns to the donor without a fee (§6). */}
          <Dialog
            open={confirmOpen}
            onOpenChange={(o) => {
              if (!pending) setConfirmOpen(o); // don't allow closing during signing/finalization
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirmation</DialogTitle>
                <DialogDescription>
                  The money is frozen in escrow. To the streamer — if they complete it; fully to you
                  — if they miss the deadline.
                </DialogDescription>
              </DialogHeader>
              {amountValid ? <FeeSplit amount={toMicro(num)} /> : null}
              <p className="text-small text-fg-muted">
                {pending
                  ? "Sign in your wallet and wait for on-chain finalization (~15–30s) — the task will appear once the escrow is confirmed."
                  : "The breakdown — if the streamer completes it. If they miss the deadline — we'll return the full amount without a fee."}
              </p>
              {!pending && longDeadline ? (
                <p className="text-small text-warn">
                  Deadline {Math.round(deadlineMs / DAY)} days: if the streamer ignores the task,
                  the refund will only come after it expires — you can't take the money earlier.
                </p>
              ) : null}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost" disabled={pending}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button variant="money" loading={pending} onClick={confirmCreate}>
                  {pending ? "Finalizing…" : "Confirm and sign"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

// ───────────────────────── left part: rules + active ─────────────────────────

export function EscrowTaskHub({ channelId, ownerAddress, handle }: GameProps) {
  const viewer = useSession().data?.address ?? null;
  const tasksQ = useEscrowTasks(channelId);
  const { run, pending } = useRun(channelId);
  // "Active" = the cycle is still running. Completed ones (RESOLVED + claimed) move to the feed; ones rejected by
  // the streamer (hidden) we hide from here too — the escrow returns to the donor on its own by timer.
  const active = (tasksQ.data?.tasks ?? []).filter(
    (t) => !t.hidden && !(t.status === "RESOLVED" && t.resolution?.claimed),
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="text-caption uppercase tracking-wide text-fg-faint">
          Active tasks · {active.length}
        </div>
        {tasksQ.isLoading ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : tasksQ.error ? (
          <ErrorState
            description="Couldn't load the tasks."
            onRetry={() => tasksQ.refetch()}
          />
        ) : active.length === 0 ? (
          <EmptyState
            title="No active tasks"
            description="Create a task on the right. Completed ones — in the &quot;Crowns&quot; feed."
          />
        ) : (
          <div className="flex flex-col [&>:last-child]:border-b-0">
            {[...active].reverse().map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                viewer={viewer}
                ownerAddress={ownerAddress}
                handle={handle}
                pending={pending}
                run={run}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** Human-readable window from WINDOWS — the rules don't hardcode durations (fast mode and calibration). */
const fmtWindow = (ms: number) =>
  ms >= 3_600_000 ? `${Math.round(ms / 3_600_000)} h` : `${Math.round(ms / 60_000)} min`;

/**
 * The game's rules — shown in the "i" modal of the game picker (GameActionRail). The outer container is the modal.
 * In icp mode the dispute windows/thresholds are the ACTIVE realm params from the canister (M1/M2: set by the owner,
 * the donor sees them BEFORE opening a dispute); outside icp (or until the canister responds) — the machine defaults.
 */
export function EscrowTaskRules({ channelId }: { channelId?: string }) {
  const params = useDisputeParams(channelId).data?.effective;
  const disputeWindow = params ? params.disputeWindowSecs * 1000 : WINDOWS.disputeWindow;
  const votingWindow = params ? params.votingWindowSecs * 1000 : WINDOWS.voting;
  const minRepPts = params ? Number(params.minReputationToDisputeMicro) / 1_000_000 : null;
  const quorumPts = params ? Number(params.quorumMicro) / 1_000_000 : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-h3 text-fg">How it works</h3>
        <ol className="text-small flex list-inside list-decimal flex-col gap-1 text-fg-muted">
          <li>A viewer crowns with a task — the money is frozen in escrow.</li>
          <li>The streamer completes the task and presses "Done" (the proof is the stream/VOD itself).</li>
          <li>
            Dispute window {fmtWindow(disputeWindow)}: if nobody disputes — the money goes to the
            streamer.
          </li>
          <li>
            Think it wasn't done? With Reign{" "}
            {minRepPts != null ? (
              <span className="mono">≥ {formatPoints(minRepPts)}</span>
            ) : (
              "≥ the threshold"
            )}{" "}
            you raise a dispute → voting {fmtWindow(votingWindow)}
            {quorumPts != null ? (
              <>
                {" "}
                (turnout quorum — <span className="mono">{formatPoints(quorumPts)}</span> points; if
                not reached — the money goes to the streamer)
              </>
            ) : null}
            .
          </li>
          <li>The community decided "not completed" → 100% back to the donor; "completed" → to the streamer.</li>
        </ol>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-h3 text-fg">Why it's fair</h3>
        <ul className="text-small flex list-inside list-disc flex-col gap-1 text-fg-muted">
          <li>
            There's no prize: the money goes either to the streamer for the work or back to the donor
            — you can't win someone else's money (not a bet).
          </li>
          <li>
            A vote is weighted by reputation at the dispute moment — you can't inflate it "for the dispute" after the fact.
          </li>
          <li>Jurors aren't paid, and whoever raises a false dispute risks their own Reign.</li>
        </ul>
      </div>
    </div>
  );
}

// ───────────────────────── reusable parts ─────────────────────────

/**
 * Task moderation — SHARED for the feed and "Active" (the same "…" and flag as a crown). A regular viewer
 * — a "Report" flag; the owner/moderator — "…" (the same ModerationMenu). A report on a task goes through the
 * game action `report` (a task is not a donation message). To the task's author and to signed-out users — nothing.
 */
function TaskModeration({
  task,
  viewer,
  isManager,
}: {
  task: EscrowTask;
  viewer?: string | null;
  isManager: boolean;
}) {
  const action = useEscrowAction(task.channelId);
  const reportSubmit = async (reason: string) =>
    (await action.mutateAsync({ op: "report", payload: { taskId: task.id, reason } })) as {
      reports?: number;
      hidden?: boolean;
    };
  const title = "Report the task";
  const description =
    "Choose a reason — the report goes to the streamer and the operator. On several reports the task text is auto-hidden.";
  if (isManager)
    return (
      <ModerationMenu
        channelId={task.channelId}
        donor={task.donor}
        reportSubmit={reportSubmit}
        reportTitle={title}
        reportDescription={description}
      />
    );
  if (viewer && viewer !== task.donor)
    return (
      <ReportDialog
        channelId={task.channelId}
        onSubmit={reportSubmit}
        title={title}
        description={description}
      />
    );
  return null;
}

/**
 * Read-only task row for the realm's SHARED crowns feed (ChannelFeed): a historical record — donor,
 * a "Task" label + status/outcome, amount, text, time, a link to the escrow. No actions/timer (management —
 * in the "Games" tab). The same row skeleton as DonationCard variant="row" → a unified look with regular crowns.
 */
export function TaskFeedRow({
  task,
  handle,
  viewer,
  manageChannelId,
}: {
  task: EscrowTask;
  handle: string;
  viewer?: string | null; // the current viewer — to show "Report" (not their own task, not a manager)
  manageChannelId?: string; // set (owner/moderator) → "…" with ban/hide of the donor, like a crown
}) {
  const final = task.resolution ?? null;
  const status = final
    ? `Outcome: ${outcomeLabel(final.outcome)}${final.claimed ? " · claimed" : ""}`
    : STATUS_LABEL[task.status];
  return (
    <div className="flex flex-col gap-2 border-b border-border py-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={`/u/${task.donor}`}
            className="text-small truncate text-fg transition-colors hover:text-status"
          >
            {shortAddress(task.donor)}
          </Link>
          <span className="text-caption shrink-0 rounded-pill border border-money px-2 py-0.5 text-money">
            Task
          </span>
          <span className="text-caption shrink-0 rounded-pill border border-border px-2 py-0.5 text-fg-faint">
            {status}
          </span>
        </div>
        <Amount micro={BigInt(task.amount)} />
      </div>
      {/* Text — only if published (SHOWN). Otherwise "[not shown]" (we don't leak the private text, §4.6);
          operator-pulled — "[removed by the platform operator]" (a moderation takedown overrides publication). */}
      {isTextPublic(task) ? (
        <p className="text-body break-words text-fg">{collapseWhitespace(task.text)}</p>
      ) : task.operatorBlocked ? (
        <p className="text-body italic text-fg-faint">[removed by the platform operator]</p>
      ) : (
        <p className="text-body italic text-fg-faint">[not shown]</p>
      )}
      {/* There was a dispute → show the vote tally and a link to the full dispute details page (the same one as in "Games"). */}
      {task.dispute ? (
        <>
          <DisputeTally dispute={task.dispute} />
          <Link
            href={`/c/${handle}/dispute/${encodeURIComponent(task.id)}`}
            className="text-small self-start text-info hover:underline"
          >
            Participants and votes ({task.dispute.votes.length}) →
          </Link>
        </>
      ) : null}
      <div className="text-small flex flex-wrap items-center gap-2 text-fg-faint">
        <span title={task.createdAt}>{timeAgo(task.createdAt)}</span>
        <div className="ml-auto flex items-center gap-2">
          {task.fundTx ? (
            <a
              href={explorerTxUrl(task.fundTx)}
              target="_blank"
              rel="noreferrer"
              className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
              title="Escrow in the blockchain explorer"
              aria-label="Escrow in the blockchain explorer"
            >
              <ExternalLinkIcon className="h-4 w-4" />
            </a>
          ) : null}
          <TaskModeration task={task} viewer={viewer} isManager={!!manageChannelId} />
        </div>
      </div>
    </div>
  );
}

function TaskCard({
  task,
  viewer,
  ownerAddress,
  handle,
  pending,
  run,
}: {
  task: EscrowTask;
  viewer: string | null;
  ownerAddress: string;
  handle: string;
  pending: boolean;
  run: Run;
}) {
  const now = useNow(); // live — timers and the appearance of buttons (claim/resolve) in real time
  const due = task.status !== "RESOLVED" ? dueResolution(task, now) : null;
  const final = task.resolution ?? null;
  const effective = final ?? due;

  const isStreamer = !!viewer && viewer === ownerAddress;
  const isDonor = !!viewer && viewer === task.donor;
  const id = task.id;
  // M2 (ADR 0021): a chain task's dispute lives in the CANISTER (opening/votes — wallet signatures,
  // the verdict is executed by a threshold resolver). The manual operator-resolver is removed — there's no human
  // in the decision chain anymore. Tasks without an escrow (mock/api) are disputed the old way, off-chain.
  const canisterDisputeQ = useCanisterDispute(task.channelId, id, task.escrowTaskId);
  const cd = canisterDisputeQ.data ?? null;
  const cdVoted = !!viewer && !!cd && cd.votes.some((v) => v.voter === viewer);
  const cdVotingOpen = !!cd && !cd.verdict && !!cd.votingEndsAtMs && now <= cd.votingEndsAtMs;
  const within = (iso?: string) => !!iso && now <= Date.parse(iso);
  const alreadyVoted = !!viewer && (task.dispute?.votes.some((v) => v.voter === viewer) ?? false);
  const winner = effective?.outcome === "to_streamer" ? ownerAddress : task.donor;
  // For a canister dispute (cd) "Claim" opens only after the REAL outcome (task.resolution:
  // the threshold resolver executed the verdict on-chain and the indexer saw it) — a time-"matured" `due`
  // is not grounds here: the on-chain escrow is Disputed, the program will reject the claim.
  const canClaim = !!effective && !final?.claimed && viewer === winner && (!cd || !!final);
  // The streamer/author always see the text; others — only SHOWN (otherwise a "under moderation"/"hidden" banner).
  // An operator takedown overrides the role: text pulled by the operator is visible to NOBODY (even the streamer/author).
  const canSeeText = !task.operatorBlocked && (isTextPublic(task) || isStreamer || isDonor);

  return (
    <div className="flex flex-col gap-2 border-b border-border py-4">
      {/* The same standard row as the crowns feed (DonationCard variant="row"): donor + status badge → amount;
          text; meta row (time · deadline/outcome · escrow link). The amount is neutral (not money-green —
          the money in the game isn't final yet: on a no-show it returns to the donor). */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={`/u/${task.donor}`}
            className="text-small truncate text-fg transition-colors hover:text-status"
          >
            {shortAddress(task.donor)}
          </Link>
          <span className="text-caption shrink-0 rounded-pill border border-border px-2 py-0.5 text-fg-faint">
            {final
              ? `Outcome: ${outcomeLabel(final.outcome)}${final.claimed ? " · claimed" : ""}`
              : STATUS_LABEL[task.status]}
          </span>
        </div>
        <Amount micro={BigInt(task.amount)} />
      </div>

      {canSeeText ? (
        <p className="text-body break-words text-fg">{collapseWhitespace(task.text)}</p>
      ) : task.operatorBlocked ? (
        <p className="text-body italic text-fg-faint">[removed by the platform operator]</p>
      ) : (
        <p className="text-body italic text-fg-faint">[not shown]</p>
      )}

      {cd ? <CanisterDisputeBlock cd={cd} now={now} /> : null}

      {/* The old off-chain dispute board — only when there's no canister one (otherwise it's already in the block above). */}
      {task.dispute && !cd ? <DisputeTally dispute={task.dispute} /> : null}
      {/* Link to the full dispute page — for BOTH circuits: in icp mode the provider merges
          the canister dispute into task.dispute, and the "Participants and votes" page reads it via the same view. */}
      {task.dispute ? (
        <Link
          href={`/c/${handle}/dispute/${encodeURIComponent(task.id)}`}
          className="text-small self-start text-info hover:underline"
        >
          Participants and votes ({task.dispute.votes.length}) →
        </Link>
      ) : null}

      <div className="text-small flex flex-wrap items-center gap-2 text-fg-faint">
        <span title={task.createdAt}>{timeAgo(task.createdAt)}</span>
        {!final && due ? (
          <span>· ready to resolve: {outcomeLabel(due.outcome)}</span>
        ) : !final && deadlineLabel(task, now) ? (
          <span className="mono">· {deadlineLabel(task, now)}</span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {/* Escrow link (survives claim) + moderation (flag/"…") — a unified look with the feed. */}
          {task.fundTx ? (
            <a
              href={explorerTxUrl(task.fundTx)}
              target="_blank"
              rel="noreferrer"
              className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
              title="Escrow in the blockchain explorer"
              aria-label="Escrow in the blockchain explorer"
            >
              <ExternalLinkIcon className="h-4 w-4" />
            </a>
          ) : null}
          <TaskModeration task={task} viewer={viewer} isManager={isStreamer} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Text moderation queue: "Show" — only while the task is alive (timer not expired, not resolved),
            otherwise it's too late to publish (it goes to a refund to the donor). "Hide" — only BEFORE acceptance
            (PENDING): after accept the money may go to the streamer, so the text must stay visible to the community (ESC-19). */}
        {isStreamer && isTextPublic(task) && task.status === "PENDING" ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => run("setTextState", { taskId: id, state: "HIDDEN" }, "Text hidden")}
          >
            Hide text
          </Button>
        ) : isStreamer && !isTextPublic(task) && !task.operatorBlocked && !due && !final ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => run("setTextState", { taskId: id, state: "SHOWN" }, "Text shown")}
          >
            Show text
          </Button>
        ) : null}
        {isStreamer && task.status === "PENDING" && !due ? (
          <>
            {/* "Accept" = on-chain accept: it also reveals the text to the community (ESC-19) — the "show first" gate
                is gone, publication happens by the acceptance itself. */}
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => run("accept", { taskId: id }, "Accepted — text shown")}
            >
              Accept
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              // Reject = hide from the frontend (no on-chain tx/gas). The escrow returns to the donor on its own by timer.
              onClick={() => run("hide", { taskId: id }, "Rejected — will return to the donor by timer")}
            >
              Reject
            </Button>
          </>
        ) : null}

        {isStreamer && task.status === "ACCEPTED" && !due ? (
          <Button
            size="sm"
            variant="money"
            disabled={pending}
            onClick={() => run("markDone", { taskId: id }, 'Marked "Done"')}
          >
            Done
          </Button>
        ) : null}

        {isDonor && task.status === "ACCEPTED" && within(task.graceUntil) ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => run("cancel", { taskId: id }, "Canceled")}
          >
            Cancel
          </Button>
        ) : null}

        {/* "Dispute": for chain tasks in icp mode the provider routes the operation to the canister itself
            (wallet signature); for the rest — the previous off-chain path. We hide it if a dispute
            is already open in the canister (cd). */}
        {task.status === "DONE" && !due && !!viewer && !isStreamer && !cd ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => run("raiseDispute", { taskId: id }, "Dispute raised")}
          >
            Dispute
          </Button>
        ) : null}

        {task.status === "DISPUTED" &&
        !cd &&
        !due &&
        !!viewer &&
        !isDonor &&
        !isStreamer &&
        !alreadyVoted ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => run("vote", { taskId: id, choice: "completed" }, "Vote counted")}
            >
              Vote: completed
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => run("vote", { taskId: id, choice: "not_completed" }, "Vote counted")}
            >
              Vote: not completed
            </Button>
          </>
        ) : null}

        {/* A vote in a CANISTER dispute: the same vote operation — the provider signs and sends it to the arbiter. */}
        {cdVotingOpen && !!viewer && !isDonor && !isStreamer && !cdVoted ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => run("vote", { taskId: id, choice: "completed" }, "Vote counted")}
            >
              Vote: completed
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => run("vote", { taskId: id, choice: "not_completed" }, "Vote counted")}
            >
              Vote: not completed
            </Button>
          </>
        ) : null}

        {canClaim ? (
          <Button
            size="sm"
            variant="money"
            disabled={pending}
            onClick={() => run("claim", { taskId: id }, "Claimed")}
          >
            Claim
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A CANISTER dispute (M2): an open board (the owner's decision — votes are visible live), the window,
 * the verdict and the on-chain signatures of the threshold resolver. The board reuses DisputeTally —
 * we synthesize an off-chain dispute shape from the canister data (micro → points at the UI boundary).
 */
function CanisterDisputeBlock({ cd, now }: { cd: CanisterDisputeView; now: number }) {
  const synthetic: TaskDispute = {
    by: cd.openedBy ?? "",
    openedAt: new Date(cd.openedAtMs ?? 0).toISOString(),
    votingEndsAt: new Date(cd.votingEndsAtMs ?? 0).toISOString(),
    quorum: Number(cd.quorumMicro) / 1_000_000,
    votes: cd.votes.map((v) => ({
      voter: v.voter,
      choice: v.choice,
      weight: Number(v.weightMicro) / 1_000_000,
      at: new Date(v.atMs).toISOString(),
    })),
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="text-caption flex flex-wrap items-center gap-x-3 text-fg-faint">
        <span>
          The dispute is decided by the canister — the outcome is signed by the threshold resolver, the platform doesn't take part.
        </span>
        {!cd.verdict && cd.votingEndsAtMs ? (
          <span className="mono">
            voting ·{" "}
            {now <= cd.votingEndsAtMs
              ? until(new Date(cd.votingEndsAtMs).toISOString(), now)
              : "awaiting verdict"}
          </span>
        ) : null}
      </div>
      <DisputeTally dispute={synthetic} />
      {cd.verdict ? (
        <div className="text-small flex flex-wrap items-center gap-x-3 text-fg-muted">
          <span>
            Verdict:{" "}
            <span
              style={{
                color: cd.verdict.outcome === "to_streamer" ? "var(--money)" : "var(--danger)",
              }}
            >
              {outcomeLabel(cd.verdict.outcome)}
            </span>
          </span>
          {cd.resolveTx ? (
            <a
              href={explorerTxUrl(cd.resolveTx)}
              target="_blank"
              rel="noreferrer"
              className="text-info hover:underline"
            >
              resolver signature ↗
            </a>
          ) : (
            <span className="text-fg-faint">executing on-chain…</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** A weight bar "completed" vs "not completed" + points/votes per side + progress to quorum + the current leader. */
function DisputeTally({ dispute }: { dispute: TaskDispute }) {
  let completed = 0;
  let not = 0;
  let cVotes = 0;
  let nVotes = 0;
  for (const v of dispute.votes) {
    if (v.choice === "completed") {
      completed += v.weight;
      cVotes += 1;
    } else {
      not += v.weight;
      nVotes += 1;
    }
  }
  const total = completed + not;
  const cPct = total > 0 ? (completed / total) * 100 : 50;
  const quorumMet = total >= dispute.quorum;
  const lead = total >= dispute.quorum && not > completed ? "to_donor" : "to_streamer";

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-[var(--bg)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col items-start">
          <span className="text-small" style={{ color: "var(--money)" }}>
            Completed
          </span>
          <span className="mono text-small text-fg">{completed} points</span>
          <span className="text-caption text-fg-faint">{cVotes} vote(s)</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-small" style={{ color: "var(--danger)" }}>
            Not completed
          </span>
          <span className="mono text-small text-fg">{not} points</span>
          <span className="text-caption text-fg-faint">{nVotes} vote(s)</span>
        </div>
      </div>
      <div className="flex h-2 overflow-hidden rounded-pill bg-surface-raised">
        <div style={{ width: `${cPct}%`, backgroundColor: "var(--money)" }} />
        <div style={{ width: `${100 - cPct}%`, backgroundColor: "var(--danger)" }} />
      </div>
      <div className="text-caption flex flex-wrap items-center justify-between gap-x-3 text-fg-faint">
        <span className="mono">
          weight {total} / quorum {dispute.quorum}
          {quorumMet ? "" : " · quorum not reached"}
        </span>
        <span>
          currently leading:{" "}
          <span style={{ color: lead === "to_streamer" ? "var(--money)" : "var(--danger)" }}>
            {lead === "to_streamer" ? "to streamer" : "refund to donor"}
          </span>
        </span>
      </div>
    </div>
  );
}
