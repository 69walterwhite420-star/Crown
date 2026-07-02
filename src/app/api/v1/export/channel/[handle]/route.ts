import { encode } from "@/lib/data/codec";
import { getStore } from "@/server/store";

export const dynamic = "force-dynamic";

const JSON_HEADERS = { "content-type": "application/json" };

/**
 * Публичный экспорт канала — инвариант §4.4 «репутация перевычислима» как кнопка, а не декларация:
 * канал (с payout-аттестацией H1) + все версии конфига + журнал репутации + текущий лидерборд как
 * сверяемая цифра. Только публичные данные (журнал текстов не содержит, §4.6). Независимый пересчёт —
 * scripts/verify-export.ts.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const { handle } = await ctx.params;
  const store = await getStore();
  const data = store.exportChannelData(handle);
  if (!data) {
    return new Response(encode({ error: "NO_CHANNEL", handle }), {
      status: 404,
      headers: JSON_HEADERS,
    });
  }
  return new Response(
    encode({
      format: "standing-channel-export/1",
      generatedAt: new Date().toISOString(),
      ...data,
    }),
    { headers: JSON_HEADERS },
  );
}
