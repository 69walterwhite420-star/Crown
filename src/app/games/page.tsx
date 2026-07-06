"use client";

import { AppHeader } from "@/components/layout/app-header";
import { GamesList } from "@/games/GamesList";

/**
 * /games — the platform's global catalog of mini-games. Games are iterated from the registry (GAMES); each card is
 * an icon, name, description and status (Available / Coming soon). You play a specific game in the realm where
 * the streamer enabled it (the per-realm status is shown there).
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
