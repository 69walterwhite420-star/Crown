"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useData } from "@/lib/data/context";
import type { DisputeVotesQuery, DisputeVotesResult, EscrowTask } from "./types";

// The vote-view types moved to types.ts (used by both machine.disputeVotesView and the
// icp provider) — the re-export keeps the screens' existing imports working.
export type { DisputeVotesQuery, DisputeVotesResult } from "./types";

/**
 * Typed hooks of the "task-for-a-crown" module on top of the generic game-bus (ADR 0016). This is the only place where
 * type safety for the game's operations is restored — screens call these hooks, not the raw `gameAction`/`gameQuery`.
 */
const KEY = (channelId: string) => ["game", "escrow-task", channelId] as const;

export function useEscrowTasks(channelId: string | undefined) {
  const data = useData();
  return useQuery({
    queryKey: KEY(channelId ?? ""),
    queryFn: () =>
      data.gameQuery({ gameId: "escrow-task", channelId: channelId!, op: "list" }) as Promise<{
        tasks: EscrowTask[];
      }>,
    enabled: !!channelId,
  });
}

export function useEscrowAction(channelId: string) {
  const data = useData();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { op: string; payload?: unknown }) =>
      data.gameAction({ gameId: "escrow-task", channelId, op: args.op, payload: args.payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY(channelId) });
      // claim/outcome change reputation in the channel → refresh the standing and the leaderboard.
      qc.invalidateQueries({ queryKey: ["standing", channelId] });
      qc.invalidateQueries({ queryKey: ["leaderboard", channelId] });
    },
  });
}

/** Paginated dispute votes (for the dispute page): filter by side, search by address, sorting. */
export function useDisputeVotes(
  channelId: string | undefined,
  taskId: string | undefined,
  opts: DisputeVotesQuery,
) {
  const data = useData();
  return useQuery({
    queryKey: ["game", "escrow-task", channelId ?? "", "dispute", taskId ?? "", opts],
    queryFn: () =>
      data.gameQuery({
        gameId: "escrow-task",
        channelId: channelId!,
        op: "disputeVotes",
        payload: { taskId, ...opts },
      }) as Promise<DisputeVotesResult>,
    enabled: !!channelId && !!taskId,
  });
}

/**
 * A dispute over a chain task FROM THE CANISTER (M2, ADR 0021): an open tally, votes, verdict,
 * on-chain resolver signatures. The method exists only on IcpDataProvider — outside icp mode the hook is off.
 * Polling: finalization and on-chain submissions arrive on the canister's timer (~20s).
 */
export function useCanisterDispute(
  channelId: string | undefined,
  taskId: string | undefined,
  escrowTaskId: string | undefined,
) {
  const data = useData();
  return useQuery({
    queryKey: ["game", "escrow-task", channelId ?? "", "canister-dispute", taskId ?? ""],
    queryFn: () => data.getCanisterDispute!(channelId!, taskId!),
    enabled: Boolean(channelId && taskId && escrowTaskId && data.getCanisterDispute),
    refetchInterval: 15_000,
  });
}
