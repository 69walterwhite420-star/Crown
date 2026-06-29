/**
 * Точка сборки слоя игр: регистрирует обработчики каждой игры в реестр шины и ре-экспортирует то, что нужно
 * провайдеру. Регистрация живёт ЗДЕСЬ (а не в bus.ts), чтобы шина не импортировала конкретные игры — иначе
 * был бы цикл bus → handlers → machine → bus. Добавить игру = импортировать её обработчики и зарегистрировать.
 */
import { GAME_HANDLERS } from "./bus";
import { escrowTaskHandlers } from "./escrow-task/handlers";

GAME_HANDLERS["escrow-task"] = escrowTaskHandlers;

export { dispatchGame, GAME_HANDLERS, GameBusError } from "./bus";
export type { GameContext, GameLedgerEntry } from "./bus";
