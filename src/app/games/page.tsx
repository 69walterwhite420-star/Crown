"use client";

import { AppHeader } from "@/components/layout/app-header";
import { GamesList } from "@/games/GamesList";

/**
 * /games — глобальный каталог мини-игр платформы. Игры перебираются из реестра (GAMES); каждая карточка —
 * иконка, название, описание и статус (Available / Coming soon). Играют в конкретную игру на дворе, где
 * стример её включил (per-realm статус показывается уже там).
 */
export default function GamesPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-content px-4 py-8 sm:py-10">
        <div className="flex w-full flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-h3 text-fg">Mini-games</h1>
            <p className="text-caption normal-case tracking-normal text-fg-faint">
              Games on top of your Reign.
            </p>
          </div>
          <GamesList enabledGames={[]} />
        </div>
      </main>
    </>
  );
}
