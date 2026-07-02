import { describe, expect, it } from "vitest";
import { classifyTaskText, hashContent } from "./moderation";

/**
 * Тест модерации ТЕКСТА ЗАДАНИЯ (escrow-task). Словарь-бэкстоп по ключевым словам УБРАН (давал ложные блоки
 * на легальных внутриигровых «укради/сопри/ограбь …»). Легальность задания судит семантический ИИ (OpenAI),
 * который тут НЕ гоняется — в тест-окружении нет OPENAI_API_KEY. Поэтому офлайн проверяем только
 * детерминированный контракт: безусловный CSAM-блок и отсутствие ложных блоков без ключа.
 */
describe("classifyTaskText — офлайн (без OpenAI-ключа)", () => {
  it("явный CSAM-маркер → HARD_BLOCK (безусловно, контекст игры не оправдывает)", async () => {
    for (const t of ["детское порно", "child porn", "csam", "педофил"]) {
      expect(await classifyTaskText(t)).toBe("HARD_BLOCK");
    }
  });

  it("без ключа умного судьи нет → не-CSAM возвращает CLEAR (нет ложных блоков)", async () => {
    // Игровые формулировки, которые прежний словарь ложно блочил — теперь проходят.
    for (const t of ["укради флаг у врагов", "сопри базу в доте", "ограбь вражеский лагерь"]) {
      expect(await classifyTaskText(t)).toBe("CLEAR");
    }
    // Обычные безобидные задания — тоже CLEAR.
    for (const t of ["станцуй джигу", "сделай 50 отжиманий", "спой песню", "покажи сетап"]) {
      expect(await classifyTaskText(t)).toBe("CLEAR");
    }
  });
});

describe("hashContent — криптостойкий SHA-256 (ончейн-якорь текста + ключ модерации)", () => {
  it("совпадает с эталонным SHA-256 нормализованного текста", async () => {
    // Известный вектор: sha256("abc"). Раньше был FNV-1a 32 бита (8 hex) → мгновенный второй прообраз:
    // подмена текста под чужой memo.m и коллизия с закэшированным CLEAR. Теперь полный SHA-256.
    expect(await hashContent("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
  it("нормализует регистр/пробелы (trim + lowercase + collapse)", async () => {
    expect(await hashContent("  Hello   World  ")).toBe(await hashContent("hello world"));
  });
  it("64 hex; разные тексты → разные хэши", async () => {
    const h = await hashContent("привет");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashContent("привет!")).not.toBe(h);
  });
});
