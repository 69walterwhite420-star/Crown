/**
 * JSON-кодек с поддержкой bigint (деньги — micro-USDC хранятся как bigint, а JSON их не умеет).
 * Используется ОБЕИМИ сторонами RPC-моста (route + ApiDataProvider), чтобы суммы переживали транспорт.
 */

interface BigintTag {
  __bigint: string;
}

// L2 (аудит): ограничиваем длину/формат — гигантская строка в __bigint → дорогая BigInt-арифметика (DoS
// публичного эндпоинта). Деньги в micro-USDC помещаются с огромным запасом (<= 40 цифр). Нестрогий тег
// проходит как обычный объект (не конвертируется), без бросков.
const BIGINT_RE = /^-?\d{1,40}$/;
function isBigintTag(v: unknown): v is BigintTag {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as BigintTag).__bigint === "string" &&
    BIGINT_RE.test((v as BigintTag).__bigint)
  );
}

/** Сериализация: bigint → { __bigint: "<dec>" }. */
export function encode(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    typeof v === "bigint" ? ({ __bigint: v.toString() } satisfies BigintTag) : v,
  );
}

/** Десериализация: { __bigint } → bigint. */
export function decode<T = unknown>(text: string): T {
  return JSON.parse(text, (_k, v) => (isBigintTag(v) ? BigInt(v.__bigint) : v)) as T;
}
