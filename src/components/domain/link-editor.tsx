"use client";

import { PlatformIcon } from "./channel-links";
import { Input } from "@/components/ui/input";
import { CHANNEL_PLATFORMS, normalizeChannelLink } from "@/lib/channel-links";
import type { ChannelLink, ChannelLinkPlatform } from "@/lib/data/types";

/** Сырой ввод по платформам (ник/URL). */
export type LinkInputs = Partial<Record<ChannelLinkPlatform, string>>;

/** Ввод по платформам → каноничные ссылки (невалидные/пустые отброшены; порядок — как в CHANNEL_PLATFORMS). */
export function linksFromInputs(inputs: LinkInputs): ChannelLink[] {
  const out: ChannelLink[] = [];
  for (const p of CHANNEL_PLATFORMS) {
    const raw = inputs[p.key]?.trim();
    if (!raw) continue;
    const url = normalizeChannelLink(p.key, raw);
    if (url) out.push({ platform: p.key, url });
  }
  return out;
}

/** Существующие ссылки → форма ввода по платформам. */
export function inputsFromLinks(links: ChannelLink[] | undefined): LinkInputs {
  return Object.fromEntries((links ?? []).map((l) => [l.platform, l.url])) as LinkInputs;
}

/**
 * Редактор ссылок на внешние платформы (allowlist + инлайн-валидация). Общий для настроек канала и профиля:
 * поле на платформу с лого, принимается только профиль/канал на поддерживаемом сервисе.
 */
export function LinkEditor({
  value,
  onChange,
}: {
  value: LinkInputs;
  onChange: (v: LinkInputs) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {CHANNEL_PLATFORMS.map((p) => {
        const raw = value[p.key] ?? "";
        const invalid = raw.trim().length > 0 && !normalizeChannelLink(p.key, raw);
        return (
          <div key={p.key} className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <span className="flex w-28 shrink-0 items-center gap-2 text-small text-fg-muted">
                <PlatformIcon platform={p.key} brand className="h-4 w-4 shrink-0" />
                {p.label}
              </span>
              <div className="min-w-0 flex-1">
                <Input
                  mono
                  placeholder={p.example}
                  value={raw}
                  onChange={(e) => onChange({ ...value, [p.key]: e.target.value })}
                  aria-invalid={invalid || undefined}
                />
              </div>
            </div>
            {invalid ? (
              <span className="pl-[7.75rem] text-small text-danger">
                Нужна ссылка на профиль/канал в {p.label} (напр. {p.example}).
              </span>
            ) : null}
          </div>
        );
      })}
      <p className="text-small text-fg-faint">
        Можно без https://. Лишние параметры срезаются — остаётся чистый адрес профиля. Произвольные сайты
        и глубокие ссылки (напр. youtube.com/watch) не принимаются.
      </p>
    </div>
  );
}
