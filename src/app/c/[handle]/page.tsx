"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { ChannelAbout } from "@/components/domain/channel-about";
import { ChannelFeed } from "@/components/domain/channel-feed";
import { ChannelHero } from "@/components/domain/channel-hero";
import { RealmRoll } from "@/components/domain/realm-roll";
import { ReignStrip } from "@/components/domain/reign-strip";
import { TierLadder } from "@/components/domain/standing";
import { ChannelGames } from "@/games/ChannelGames";
import { GameActionRail } from "@/games/GameActionRail";
import { useEscrowTasks } from "@/games/escrow-task/hooks";
import { AppHeader } from "@/components/layout/app-header";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useChannel,
  useChannelConfig,
  useDonations,
  useLeaderboard,
  useSession,
  useStanding,
} from "@/lib/data/hooks";
import { shortAddress } from "@/lib/utils";

export default function ChannelPage() {
  const params = useParams<{ handle: string }>();
  const handle = params.handle;

  const channelQ = useChannel(handle);
  const channel = channelQ.data;
  const configQ = useChannelConfig(channel?.id);
  const sessionQ = useSession();
  const address = sessionQ.data?.address ?? null;
  const standingQ = useStanding(channel?.id, address);
  const donationsQ = useDonations(channel?.id);
  const escrowTasks = useEscrowTasks(channel?.id).data?.tasks ?? [];
  const boardQ = useLeaderboard(channel?.id, "all_time");

  const enabledGames = configQ.data?.enabledGames ?? [];
  const hasGames = enabledGames.length > 0;
  const [tabState, setTabState] = useState<string | null>(null);
  const activeTab = tabState ?? (hasGames ? "games" : "feed");

  // Владелец, смотрящий свой двор → в ленте доступна модерация/бан (модераторы — из студии/очереди).
  const canManage = !!address && channel?.ownerAddress === address;

  // Статистика для героя (из загруженных донатов) + The Crown (топ-1 лидерборда).
  const allDonations = donationsQ.data?.items ?? [];
  const stats = donationsQ.data
    ? {
        donors: new Set(allDonations.map((d) => d.donor)).size,
        total: allDonations.reduce((s, d) => s + d.amount, 0n),
      }
    : null;
  const topEntry = boardQ.data?.[0];
  const topPatron = topEntry ? (topEntry.displayName ?? shortAddress(topEntry.donor)) : null;

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-content px-4 pb-10 pt-4">
        {channelQ.isLoading ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : channelQ.error ? (
          <ErrorState description="Couldn't load the realm." onRetry={() => channelQ.refetch()} />
        ) : !channel ? (
          <EmptyState title="Realm not found" description={`No realm @${handle} exists.`} />
        ) : channel.status === "SUSPENDED" || channel.status === "BANNED" ? (
          <EmptyState
            title="Realm unavailable"
            description="This realm is suspended. If this is a mistake, contact support."
          />
        ) : (
          <div className="flex flex-col gap-6">
            <ChannelHero
              channel={channel}
              config={configQ.data}
              donorsCount={stats?.donors}
              totalDonated={stats?.total}
              topPatron={topPatron}
            />

            {/* Ниже героя: слева Reign + вкладки, справа закреплённый рейл (Crown + Realm roll).
                На мобиле — поток: Reign → Crown → Realm roll → вкладки. */}
            <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[1fr_360px] lg:grid-rows-[auto_1fr] lg:items-start lg:gap-x-6 lg:gap-y-6">
              <div className="min-w-0 lg:col-start-1 lg:row-start-1">
                <ReignStrip standing={standingQ.data} loading={standingQ.isLoading} />
              </div>

              <aside
                id="crown"
                className="rail-pinned-right flex scroll-mt-20 flex-col gap-6 lg:col-start-2 lg:row-span-2 lg:row-start-1"
              >
                {configQ.data && sessionQ.data ? (
                  <GameActionRail
                    channel={channel}
                    config={configQ.data}
                    session={sessionQ.data}
                    standing={standingQ.data}
                    standingLoading={standingQ.isLoading}
                    handle={handle}
                    enabledGames={enabledGames}
                  />
                ) : (
                  <Skeleton className="h-72 w-full rounded-lg" />
                )}
                <RealmRoll channelId={channel.id} handle={handle} currentAddress={address} />
              </aside>

              <div className="min-w-0 lg:col-start-1 lg:row-start-2">
                <Tabs value={activeTab} onValueChange={setTabState} className="flex flex-col gap-3">
                  <TabsList className="w-full">
                    {hasGames ? <TabsTrigger value="games">Games</TabsTrigger> : null}
                    <TabsTrigger value="feed">Feed</TabsTrigger>
                    <TabsTrigger value="ranks">Ranks</TabsTrigger>
                    <TabsTrigger value="about">About</TabsTrigger>
                  </TabsList>

                  {hasGames ? (
                    <TabsContent value="games">
                      <ChannelGames
                        channelId={channel.id}
                        ownerAddress={channel.ownerAddress}
                        handle={handle}
                        enabledGames={enabledGames}
                      />
                    </TabsContent>
                  ) : null}

                  <TabsContent value="feed">
                    {donationsQ.isLoading ? (
                      <Skeleton className="h-24 w-full rounded-lg" />
                    ) : (
                      <ChannelFeed
                        donations={allDonations}
                        tasks={escrowTasks}
                        handle={handle}
                        channelId={channel.id}
                        reportable
                        manageChannelId={canManage ? channel.id : undefined}
                      />
                    )}
                  </TabsContent>

                  <TabsContent value="ranks">
                    {configQ.data ? (
                      <TierLadder tiers={configQ.data.tiers} currentTierName={standingQ.data?.tier?.name} />
                    ) : (
                      <Skeleton className="h-40 w-full" />
                    )}
                  </TabsContent>

                  <TabsContent value="about">
                    <ChannelAbout channel={channel} config={configQ.data} />
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
