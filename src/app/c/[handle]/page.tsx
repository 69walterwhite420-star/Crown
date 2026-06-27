"use client";

import { useParams } from "next/navigation";
import { ChannelHeader } from "@/components/domain/channel-header";
import { DonateWidget } from "@/components/domain/donate";
import { DonationHistory } from "@/components/domain/donation-history";
import { TierLadder } from "@/components/domain/standing";
import { AppHeader } from "@/components/layout/app-header";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useChannel,
  useChannelConfig,
  useDonations,
  useSession,
  useStanding,
} from "@/lib/data/hooks";

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

  // Владелец, смотрящий свой канал → в ленте доступна кнопка «Забанить» (модераторы банят из студии/очереди).
  const canManage = !!address && channel?.ownerAddress === address;

  // Статистика для большой шапки (из загруженных донатов; уникальные донатёры + сумма).
  const allDonations = donationsQ.data?.items ?? [];
  const stats = donationsQ.data
    ? {
        donors: new Set(allDonations.map((d) => d.donor)).size,
        total: allDonations.reduce((s, d) => s + d.amount, 0n),
      }
    : null;

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-content px-4 pb-8 pt-4">
        {channelQ.isLoading ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : channelQ.error ? (
          <ErrorState description="Не удалось загрузить канал." onRetry={() => channelQ.refetch()} />
        ) : !channel ? (
          <EmptyState title="Канал не найден" description={`Канала @${handle} не существует.`} />
        ) : channel.status === "SUSPENDED" || channel.status === "BANNED" ? (
          <EmptyState
            title="Канал недоступен"
            description="Этот канал приостановлен. Если это ошибка — обратись в поддержку."
          />
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">
            {/* Левая колонка — шапка канала + контент (как на polymarket: вся инфа слева, не на весь экран).
                min-w-0: иначе широкий контент (длинные ники/mono-адреса) раздувает 1fr-трек → страница шире
                вьюпорта и правый блок хедера («Войти») уезжает за край. */}
            <div className="flex min-w-0 flex-col gap-8">
              <ChannelHeader
                channel={channel}
                config={configQ.data}
                donorsCount={stats?.donors}
                totalDonated={stats?.total}
              />
              {/* Контент канала — табами (мини-хедер), а не простынёй. Новые фичи = новая вкладка. */}
              <Tabs defaultValue="feed" className="flex flex-col gap-1">
                <TabsList className="w-full">
                  <TabsTrigger value="feed">Лента</TabsTrigger>
                  <TabsTrigger value="donations">Донаты</TabsTrigger>
                  <TabsTrigger value="tiers">Тиры</TabsTrigger>
                </TabsList>

                <TabsContent value="feed">
                  {donationsQ.isLoading ? (
                    <Skeleton className="h-24 w-full rounded-lg" />
                  ) : (
                    <DonationHistory
                      donations={(donationsQ.data?.items ?? []).filter(
                        (d) => d.message?.state === "SHOWN",
                      )}
                      title="Показанные сообщения"
                      reportable
                      plain
                      manageChannelId={canManage ? channel.id : undefined}
                    />
                  )}
                </TabsContent>

                <TabsContent value="donations">
                  {donationsQ.isLoading ? (
                    <Skeleton className="h-24 w-full rounded-lg" />
                  ) : (
                    <DonationHistory
                      donations={donationsQ.data?.items ?? []}
                      collapsible={false}
                      manageChannelId={canManage ? channel.id : undefined}
                    />
                  )}
                </TabsContent>

                <TabsContent value="tiers">
                  {configQ.data ? (
                    <TierLadder tiers={configQ.data.tiers} />
                  ) : (
                    <Skeleton className="h-40 w-full" />
                  )}
                </TabsContent>
              </Tabs>
            </div>

              {/* Правая колонка — моё standing + донат. ФИКСИРОВАНА на экране (rail-pinned-right): не
                  двигается ВООБЩЕ при скролле, даже у футтера. Грид резервирует 360px-трек, поэтому левая
                  колонка не плывёт. На мобиле (<lg) — обычным блоком в потоке. */}
              <aside className="flex flex-col gap-6 rail-pinned-right">
                {configQ.data && sessionQ.data ? (
                  <DonateWidget
                    channel={channel}
                    config={configQ.data}
                    session={sessionQ.data}
                    standing={standingQ.data}
                    standingLoading={standingQ.isLoading}
                  />
                ) : (
                  <Skeleton className="h-72 w-full rounded-lg" />
                )}
              </aside>
            </div>
        )}
      </main>
    </>
  );
}
