"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Amount } from "./amount";
import { ChannelLinkButtons } from "./channel-links";
import { HeaderActions, Monogram } from "./header-actions";
import { CrownLogo } from "@/components/crown-logo";
import { useProfile } from "@/lib/data/hooks";
import type { Channel, ChannelConfig } from "@/lib/data/types";
import { channelHue, cn } from "@/lib/utils";

const HEADER_H = 60; // высота глобальной шапки (--header-h): относительно неё считаем «свёрнуто».

function monthYear(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/** Гербовый градиент баннера из детерминированного оттенка канала — приглушённый (чёрный+золото). */
function bannerStyle(seed: string): React.CSSProperties {
  const h = channelHue(seed);
  return {
    backgroundImage: `linear-gradient(135deg, hsl(${h} 38% 13%) 0%, hsl(${h} 26% 7%) 55%, #000 100%)`,
  };
}

/** Мелкая метка-факт в стат-строке героя (подпись + значение). */
function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-caption uppercase tracking-wide text-fg-faint">{label}</span>
      <span className="text-fg">{children}</span>
    </span>
  );
}

/**
 * Hero двора (стриминг-стиль): гербовый баннер, аватар внахлёст, имя/@handle, описание, соц-ссылки и
 * стат-строка (Crowned · 👑 The Crown · since). При скролле, когда имя уходит под глобальную
 * шапку, появляется липкая компактная плашка с кнопкой Crown (якорь к карточке доната #crown).
 */
export function ChannelHero({
  channel,
  config,
  totalDonated,
  topPatron,
}: {
  channel: Channel;
  config?: ChannelConfig;
  donorsCount?: number;
  totalDonated?: bigint;
  topPatron?: string | null;
}) {
  const ownerProfile = useProfile(channel.ownerAddress);
  const name = ownerProfile.data?.displayName?.trim() || `@${channel.handle}`;
  const links = ownerProfile.data?.links ?? [];
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (e) setCollapsed(!e.isIntersecting);
      },
      { rootMargin: `-${HEADER_H}px 0px 0px 0px`, threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <>
      {/* Липкая компактная плашка — fixed-оверлей под глобальной шапкой; ширина = левая колонка. */}
      <div
        aria-hidden={!collapsed}
        className={cn(
          "fixed inset-x-0 top-[var(--header-h)] z-20 transition-all duration-200 ease-ease",
          collapsed ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0",
        )}
      >
        <div className="mx-auto max-w-content px-4 lg:pr-[calc(360px+1.5rem)]">
          <div className="flex h-[54px] items-center gap-3 border-b border-border bg-[var(--bg)] px-4 shadow-sm">
            <Monogram name={name} size="sm" />
            <span className="min-w-0 flex-1 truncate font-display text-fg">{name}</span>
            <a
              href="#crown"
              className="flex items-center gap-1 rounded-md border border-money-dim bg-money-bg/40 px-3 py-1.5 text-small font-semibold text-money transition-colors hover:border-money hover:bg-money-bg"
            >
              Crown ▸
            </a>
          </div>
        </div>
      </div>

      <header className="flex flex-col">
        {/* Баннер + действия */}
        <div className="relative">
          <div
            className="relative h-28 w-full overflow-hidden rounded-xl border border-border sm:h-36"
            style={bannerStyle(channel.handle)}
          >
            <CrownLogo
              size={132}
              className="absolute -right-3 bottom-1 text-status opacity-[0.08]"
            />
          </div>
          <div className="absolute right-3 top-3">
            <HeaderActions payoutAddress={channel.payoutAddress} />
          </div>
          <Monogram
            name={name}
            size="xl"
            className="absolute -bottom-9 left-4 ring-4 ring-[var(--bg)] sm:left-6"
          />
        </div>

        {/* Личность — под баннером, с отступом сверху под нахлёст аватара */}
        <div className="flex flex-col gap-3 pt-12 sm:pt-14">
          <div className="flex min-w-0 flex-col gap-0.5">
            <Link
              href="/"
              className="w-fit text-caption uppercase tracking-wide text-fg-faint transition-colors hover:text-fg-muted"
            >
              Realm
            </Link>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 ref={titleRef} className="text-display-l leading-tight text-fg">
                {name}
              </h1>
              <span className="mono text-fg-faint">@{channel.handle}</span>
            </div>
          </div>

          {config?.description?.trim() ? (
            <p className="max-w-2xl whitespace-pre-wrap break-words text-fg-muted">
              {config.description}
            </p>
          ) : null}

          {links.length > 0 ? <ChannelLinkButtons links={links} variant="pill" /> : null}

          {/* Стат-строка */}
          <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-3 text-small">
            {totalDonated !== undefined ? (
              <Stat label="Crowned">
                <Amount micro={totalDonated} className="text-fg" />
              </Stat>
            ) : null}
            {topPatron ? (
              <span className="flex items-center gap-1.5">
                <span aria-hidden>👑</span>
                <span className="truncate text-status" title={`The Crown: ${topPatron}`}>
                  {topPatron}
                </span>
              </span>
            ) : null}
            <Stat label="Since">
              <span className="text-fg-muted">{monthYear(channel.createdAt)}</span>
            </Stat>
          </div>
        </div>
      </header>
    </>
  );
}
