"use client";

import { GAME_PANELS } from "./panels";
import type { GameId } from "./types";

/**
 * Левый таб «Активные»: активные партии включённых на канале игр (мониторинг). Выбор игры, правила и форма
 * действия переехали в пикер правого рейла (GameActionRail) — тут больше нет карточек-селекторов и правил.
 * Рендерит Hub'ы, перебирая реестр GAME_PANELS: включил игру → её активные партии появляются автоматически.
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
