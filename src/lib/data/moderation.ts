/**
 * Модерационный конвейер (core-spec.md §8). Структура:
 *   [ВВОД] → [ЯЗЫК] детект → [АВТО] классификатор → вердикт (+ дедуп по хэшу).
 *
 * Авто-слой подключаемый и АСИНХРОННЫЙ (AutoModerator). По умолчанию — локальный wordlist (только явные
 * хард-маркеры). Если задан серверный OPENAI_API_KEY — используется OpenAI omni-moderation (бесплатный,
 * мультиязычный, текст+картинки). Выбор делает resolveAutoModerator() по env (ключ серверный, в браузер не
 * попадает → клиент всегда на словаре).
 */
import type { ModerationVerdict } from "./types";

export interface AutoModerator {
  classify(text: string, lang: string): Promise<ModerationVerdict>;
}

// ПОЛИТИКА (решение продукта): отдельные слова и мат НЕ цензурим и НЕ флагаем — это вкус стримера, он
// скрывает вручную. Авто-слой ловит только запрещёнку → HARD_BLOCK (карантин + эскалация в T&S). FLAG-
// словаря по умолчанию НЕТ. Семантический детект — OpenAI (ниже); локальный список — заглушка под явные маркеры.
const DEFAULT_HARD_LIST = ["csam", "childporn", "child porn", "zoophilia", "hardblock"];
const DEFAULT_FLAG_LIST: string[] = [];

/** Локальный авто-модератор: ловит только хард-маркеры запрещёнки; мат/любые слова пропускает (CLEAR). */
export const localAutoModerator: AutoModerator = {
  async classify(text) {
    const lower = text.toLowerCase();
    if (DEFAULT_HARD_LIST.some((w) => lower.includes(w))) return "HARD_BLOCK";
    if (DEFAULT_FLAG_LIST.some((w) => lower.includes(w))) return "FLAG";
    return "CLEAR";
  },
};

// Категории OpenAI omni-moderation → авто-карантин (HARD_BLOCK). По умолчанию только сексуализация
// несовершеннолетних (CSAM) — юридический must, нулевая толерантность. Остальное (sexual/hate/harassment/
// self-harm/violence) НЕ баним — стример решает сам (политика «не цензурим, стример скрывает»). Чтобы
// ужесточить — добавь сюда категории (напр. "illicit/violent", "sexual").
const OPENAI_HARD_CATEGORIES = ["sexual/minors"] as const;

/**
 * Внешний авто-модератор поверх OpenAI omni-moderation (бесплатный endpoint /v1/moderations). Мультиязычный.
 * Маппит флагнутые категории в вердикт по OPENAI_HARD_CATEGORIES. На сбое/таймауте — FLAG (НЕ блокируем
 * деньги и НЕ авто-публикуем: текст уходит в HELD на ручное решение). Только сервер (ключ серверный).
 */
export function createOpenAiModerator(apiKey: string): AutoModerator {
  return {
    async classify(text) {
      try {
        const res = await fetch("https://api.openai.com/v1/moderations", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: "omni-moderation-latest", input: text }),
        });
        if (!res.ok) {
          console.error("[moderation] OpenAI вернул", res.status);
          return "FLAG"; // не смогли проверить → на ручное решение (не показываем авто), деньги не трогаем
        }
        const data = (await res.json()) as {
          results?: { categories?: Record<string, boolean> }[];
        };
        const cats = data.results?.[0]?.categories ?? {};
        if (OPENAI_HARD_CATEGORIES.some((c) => cats[c])) return "HARD_BLOCK";
        return "CLEAR"; // всё прочее (включая мат) пропускаем — стример скрывает вручную
      } catch (e) {
        console.error("[moderation] OpenAI ошибка:", e);
        return "FLAG";
      }
    },
  };
}

// Выбор авто-модератора по серверному env (мемоизируется). OPENAI_API_KEY — серверная переменная (НЕ
// NEXT_PUBLIC), в браузерный bundle не попадает → в mock/api клиенте всегда локальный словарь.
let cachedModerator: AutoModerator | null = null;
export function resolveAutoModerator(): AutoModerator {
  if (cachedModerator) return cachedModerator;
  const key = typeof process !== "undefined" ? process.env.OPENAI_API_KEY : undefined;
  cachedModerator = key ? createOpenAiModerator(key) : localAutoModerator;
  return cachedModerator;
}

export function detectLang(text: string): string {
  if (/[¡¿]|gracias|directo/i.test(text)) return "es";
  if (/[а-яё]/i.test(text)) return "ru";
  return "en";
}

/** Стабильный хэш нормализованного контента (FNV-1a) — для дедупа карантина и опц. ончейн-якоря. */
export function hashContent(text: string): string {
  const norm = text.trim().toLowerCase().replace(/\s+/g, " ");
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export interface ModerationOutcome {
  verdict: ModerationVerdict;
  lang: string;
  contentHash: string;
  deduped: boolean; // true → решение взято из кэша (повтор контента), без повторного ревью/репорта
}

/**
 * Прогон текста через конвейер с дедупом. Дедуп — В ПРЕДЕЛАХ канала (`scope`): повтор того же контента
 * на ОДНОМ канале берётся из кэша (флуд схлопывается в O(1), без повторного ревью/репорта), но первое
 * появление на каждом канале ревьюится и репортится отдельно — у каждого стримера своя очередь T&S.
 */
export async function runPipeline(
  text: string,
  cache: Map<string, ModerationVerdict>,
  opts?: { scope?: string; auto?: AutoModerator },
): Promise<ModerationOutcome> {
  const contentHash = hashContent(text);
  const lang = detectLang(text);
  const key = opts?.scope ? `${opts.scope}:${contentHash}` : contentHash;
  const cached = cache.get(key);
  if (cached) return { verdict: cached, lang, contentHash, deduped: true };
  const verdict = await (opts?.auto ?? localAutoModerator).classify(text, lang);
  cache.set(key, verdict);
  return { verdict, lang, contentHash, deduped: false };
}
