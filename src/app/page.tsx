"use client";

import Link from "next/link";
import { Amount } from "@/components/domain/amount";
import { DonorProfile } from "@/components/domain/donor-profile";
import { AppHeader } from "@/components/layout/app-header";
import { ConnectWalletButton } from "@/components/layout/connect-wallet-button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { useHomeFeed, useSession } from "@/lib/data/hooks";
import type { LiveChannel } from "@/lib/data/types";
import { plural } from "@/lib/utils";

/**
 * Главная — личная база (ADR 0018). Залогинен → ТВОЙ профиль как база: «требует тебя» (открытые циклы) +
 * куда донатил + активность (профиль совмещён с главной). Не залогинен → срез живого (демо-как-маркетинг).
 * Каталог каналов понижен на `/discovery`.
 */
export default function HomePage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-content flex-col gap-6 px-4 py-8">
        <Home />
      </main>
    </>
  );
}

function Home() {
  const session = useSession();
  if (session.isLoading) return <Skeleton className="h-28 w-full rounded-lg" />;
  const address = session.data?.address ?? null;
  // Залогинен → профиль-база (открытые циклы + донаты + активность в одном месте).
  if (address) return <DonorProfile address={address} editable />;
  // Не залогинен → что кипит.
  return <LiveNow />;
}

function LiveCard({ l }: { l: LiveChannel }) {
  return (
    <Link
      href={`/c/${l.handle}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="mono text-fg">@{l.handle}</span>
        <Amount micro={l.lockedMicro} />
      </div>
      <div className="text-small text-fg-muted">
        {l.activeCount} {plural(l.activeCount, ["задание", "задания", "заданий"])} · {l.participants}{" "}
        {plural(l.participants, ["участник", "участника", "участников"])}
      </div>
    </Link>
  );
}

/** Срез живого для гостя: ранг по разным участникам (не по сумме — §4.3). Никогда не грид «выбери канал». */
function LiveNow() {
  const { data, isLoading, error, refetch } = useHomeFeed();
  if (isLoading) return <Skeleton className="h-28 w-full rounded-lg" />;
  if (error)
    return <ErrorState description="Не удалось загрузить главную." onRetry={() => refetch()} />;

  const live = data?.live ?? [];
  if (live.length === 0) {
    return (
      <EmptyState
        title="Пока тихо"
        description="Подключи кошелёк — здесь будут твои открытые циклы и куда ты донатил."
        action={<ConnectWalletButton />}
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-display-l text-fg">Прямо сейчас</h1>
        <p className="text-fg-muted">
          Где кипит — по числу разных участников. Подключи кошелёк, чтобы видеть свои циклы.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {live.map((l) => (
          <LiveCard key={l.channelId} l={l} />
        ))}
      </div>
      <Link href="/discovery" className="text-small text-fg-muted hover:text-fg">
        Смотреть все каналы →
      </Link>
    </div>
  );
}
