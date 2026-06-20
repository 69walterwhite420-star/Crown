import { encode } from "@/lib/data/codec";
import { getStore } from "@/server/store";

export const dynamic = "force-dynamic";

/**
 * SSE-поток оверлея (backend/spec.md §5). Подписывается на overlay-события серверного store и стримит
 * их клиенту. Store — singleton, поэтому донат/показ из ЛЮБОГО запроса доставляется сюда в реальном
 * времени. Только SHOWN/tier-up (инвариант приватности соблюдён в store).
 *
 * Очистка (clearInterval + unsubscribe) идемпотентна и срабатывает по трём путям: stream.cancel(),
 * abort-сигнал запроса (backstop при обрыве, когда cancel() может не вызваться) и неудачный enqueue
 * на закрытый контроллер (само-завершение мёртвого соединения) — иначе таймер и подписка утекают.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ channelId: string }> },
): Promise<Response> {
  const { channelId } = await params;
  const store = getStore();
  const enc = new TextEncoder();

  let unsubscribe: () => void = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (ping) clearInterval(ping);
    unsubscribe();
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          cleanup(); // контроллер закрыт — клиент отключился
        }
      };
      send(": connected\n\n");
      unsubscribe = store.subscribeOverlay(channelId, (event) => {
        // Кадр не должен ломать emitOverlay/createDonation (overlay эмитится на хот-пути доната).
        try {
          send(`data: ${encode(event)}\n\n`);
        } catch {
          /* битый кадр игнорируем */
        }
      });
      ping = setInterval(() => send(": ping\n\n"), 25_000);
    },
    cancel() {
      cleanup();
    },
  });

  req.signal.addEventListener("abort", cleanup);

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
