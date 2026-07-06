/**
 * Assembly point of the games layer: registers each game's handlers into the bus registry and re-exports what the
 * provider needs. Registration lives HERE (not in bus.ts), so the bus doesn't import specific games — otherwise
 * there'd be a cycle bus → handlers → machine → bus. Adding a game = importing its handlers and registering them.
 */
import { GAME_HANDLERS } from "./bus";
import { escrowTaskHandlers } from "./escrow-task/handlers";

GAME_HANDLERS["escrow-task"] = escrowTaskHandlers;

export { dispatchGame, GAME_HANDLERS, GameBusError } from "./bus";
export type { GameContext, GameLedgerEntry } from "./bus";
