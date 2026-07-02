/**
 * Движок репутации — ОБЩИЙ чистый модуль (ADR 0001). Курс ФИКСИРОВАН: 1 USDC = 1 очко, без кривых,
 * множителей и decay (продуктовое решение, ADR 0007). Стример настраивает только ТИРЫ/ПОРОГИ (сколько
 * очков нужно для перков/участия в мини-играх), не стоимость очка. Детерминированно и перевычислимо
 * (CLAUDE.md §4.4): одинаковый журнал → одинаковая цифра везде.
 */
import type { LedgerEvent, MicroUSDC, Points, Tier } from "./data/types";

/** Фиксированный курс начисления: 1 USDC = 1 очко. */
export const POINTS_PER_USDC = 1;

/** Сколько micro-USDC даёт 1 очко: 1e6 micro/USDC ÷ 1 очко/USDC = 1_000_000 micro/очко. */
const MICRO_PER_POINT = 1_000_000n / BigInt(POINTS_PER_USDC);

/**
 * Очки за донат: сумма в USDC, ОКРУГЛЁННАЯ ВНИЗ до целого очка (1 USDC = 1 очко). Считаем ЦЕЛОЧИСЛЕННО в
 * bigint (не через float), иначе на больших суммах Number(micro) теряет точность и независимый пересчёт не
 * сойдётся (инвариант §4.4 — детерминизм; R1/ADR 0012).
 *
 * Именно floor, а не «к ближайшему»: округление вверх СУПЕРаддитивно (round(0.5)+round(0.5)=2 > round(1)=1,
 * и так на ЛЮБОЙ границе .5) — дроблением доната на куски по 0.5 донор удваивал репутацию за те же деньги.
 * floor субаддитивен (floor(a)+floor(b) ≤ floor(a+b)) → дробление НИКОГДА не даёт лишних очков, ставка
 * ограничена сверху 1 очком/USDC. Порог показа текста живёт отдельно (minDonationWithText).
 */
export function pointsForAmount(amountMicro: MicroUSDC): Points {
  if (amountMicro <= 0n) return 0;
  return Number(amountMicro / MICRO_PER_POINT);
}

/**
 * Свёртка журнала донора по каналу → текущие очки. Сумма забанкованных дельт; ADMIN_VOID уже отрицателен.
 * Репутация только растёт (кроме ADMIN_VOID), поэтому клампим к ≥0.
 */
export function computePoints(events: LedgerEvent[]): Points {
  let total = 0;
  for (const e of events) total += e.pointsDelta;
  return Math.max(0, Math.round(total));
}

/**
 * Очки на МОМЕНТ времени (снэпшот): та же свёртка, но только по событиям с `ts ≤ asOf`. Нужно мини-играм со
 * спорами — вес голоса фиксируется на секунду поднятия спора (ADR 0015, спека игры §5), чтобы нельзя было
 * нафармить/докупить репутацию «под этот спор» после его старта. `asOf` — ISO-строка; сравнение по времени.
 */
export function computePointsAsOf(events: LedgerEvent[], asOf: string): Points {
  const cut = Date.parse(asOf);
  return computePoints(events.filter((e) => Date.parse(e.ts) <= cut));
}

export interface TierResolution {
  tier?: Tier; // undefined → очков меньше порога ПЕРВОГО тира («без тира»)
  nextTier?: Tier; // следующий рубеж; для «без тира» это первый тир
  progressToNext: number; // 0..1 (к nextTier; для «без тира» — к первому тиру от 0)
}

/**
 * Текущий тир по очкам + прогресс до следующего. Тиры/пороги — единственный рычаг стримера.
 * Тир зарабатывается с порога: если очков меньше порога ПЕРВОГО тира — тира нет (tier: undefined),
 * nextTier указывает на первый. Частный случай — первый тир с порогом 0 (как дефолтный «Новичок»): это
 * пол, его получает любой донор (ветка «ниже входа» тогда недостижима). Обе конфигурации поддержаны.
 */
export function resolveTier(points: Points, tiers: Tier[]): TierResolution {
  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);
  const first = sorted[0];
  if (!first) return { progressToNext: 0 }; // тиров нет вовсе
  if (points < first.threshold) {
    // ниже входа: прогресс к первому тиру от 0 (threshold > 0 здесь гарантирован проверкой выше).
    return { nextTier: first, progressToNext: first.threshold > 0 ? clamp01(points / first.threshold) : 1 };
  }
  let current = first;
  for (const t of sorted) {
    if (points >= t.threshold) current = t;
  }
  const idx = sorted.indexOf(current);
  const nextTier = sorted[idx + 1];
  const progressToNext = nextTier
    ? clamp01((points - current.threshold) / (nextTier.threshold - current.threshold))
    : 1;
  return { tier: current, nextTier, progressToNext };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
