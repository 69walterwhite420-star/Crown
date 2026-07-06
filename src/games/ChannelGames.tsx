"use client";

import { GAME_PANELS } from "./panels";
import type { GameId } from "./types";

/**
 * Left "Active" tab: active rounds of the games enabled in this realm (monitoring). Game selection, rules, and the
 * action form moved to the right rail's picker (GameActionRail) — there are no more selector cards or rules here.
 * Renders Hubs by iterating the GAME_PANELS registry: enable a game → its active rounds appear automatically.
 */
export function ChannelGames({
  channelId,
  ownerAddress,
  handle,
  enabledGames,
}: {
  channelId: string;
  ownerAddress: string;
  handle: string;
  enabledGames: string[];
}) {
  const hubs = enabledGames
    .map((id) => ({ id, Hub: GAME_PANELS[id as GameId]?.Hub }))
    .filter((x): x is { id: string; Hub: NonNullable<typeof x.Hub> } => !!x.Hub);

  if (hubs.length === 0) return null;
  return (
    <div className="flex flex-col gap-6">
      {hubs.map(({ id, Hub }) => (
        <Hub key={id} channelId={channelId} ownerAddress={ownerAddress} handle={handle} />
      ))}
    </div>
  );
}
