/**
 * Каноническая сериализация + SHA-256 для дайджестов пруф-якоря и независимой проверки экспорта.
 *
 * Требование — ДЕТЕРМИНИЗМ между процессами и рестартами: один и тот же набор данных обязан давать
 * байт-в-байт одну строку у сервера (публикующего якорь) и у третьей стороны (пересчитывающей его из
 * экспорта). Обычный JSON.stringify зависит от порядка вставки ключей (in-memory объект vs объект,
 * восстановленный из Postgres, могут отличаться) — поэтому ключи сортируются рекурсивно.
 *
 * НЕ использовать hashContent из moderation.ts: он нормализует текст (lowercase/трим) — для дайджестов
 * это коллапсировало бы разные base58-адреса, различающиеся регистром.
 */

/** JSON с рекурсивно отсортированными ключами; bigint → строка с тегом (симметрия кодека не нужна —
 *  строка используется только как вход хэша, обратно не разбирается). undefined в объектах опускается
 *  (как в JSON.stringify), чтобы «нет поля» и «поле undefined» давали один дайджест. */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "bigint") return `"__bigint:${(value as bigint).toString()}"`;
  if (t === "number" || t === "boolean") return JSON.stringify(value);
  if (t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (t === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error(`stableStringify: несериализуемый тип ${t}`);
}

/** SHA-256 hex БЕЗ нормализации входа. Web Crypto — единый в браузере, node и vitest. */
export async function sha256Hex(s: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
