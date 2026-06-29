"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useData } from "@/lib/data/context";
import type { EscrowTask } from "./types";

/**
 * Типизированные хуки модуля «задание-донат» поверх обобщённого game-bus (ADR 0016). Только тут восстановлена
 * типобезопасность операций игры — экраны зовут эти хуки, а не сырые `gameAction`/`gameQuery`.
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
      // claim/исход меняют репутацию на канале → освежим standing и лидерборд.
      qc.invalidateQueries({ queryKey: ["standing", channelId] });
      qc.invalidateQueries({ queryKey: ["leaderboard", channelId] });
    },
  });
}
