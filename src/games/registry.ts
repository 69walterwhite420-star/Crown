import { escrowTask } from "./escrow-task/manifest";
import type { GameId, GameModule } from "./types";

/**
 * The single list of the platform's mini-games (ADR 0016). Adding a game = adding its manifest here. The site
 * (realm page, studio) renders games by ITERATING this registry rather than hardcoding each one — a new game
 * appears in the UI automatically.
 */
export const GAMES: readonly GameModule[] = [escrowTask];

export function getGame(id: GameId): GameModule | undefined {
  return GAMES.find((g) => g.id === id);
}
