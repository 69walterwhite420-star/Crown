import { decode, encode } from "@/lib/data/codec";
import type { Address } from "@/lib/data/types";
import { ingestSignature } from "@/server/ingest";
import { getStore } from "@/server/store";

export const dynamic = "force-dynamic";

// Белый список разрешённых методов стора (все методы DataProvider, кроме subscribeOverlay, + dev-reset).
const ALLOWED = new Set<string>([
  "getSession",
  "connect",
  "disconnect",
  "getProfile",
  "updateProfile",
  "listChannels",
  "getChannel",
  "getMyChannel",
  "getChannelConfig",
  "createChannel",
  "activateChannel",
  "updateChannelConfig",
  "getStanding",
  "getLeaderboard",
  "createDonation",
  "listDonations",
  "getModerationQueue",
  "setMessageState",
  "getChannelBlocklist",
  "addChannelBlock",
  "removeChannelBlock",
  "getOperatorQueue",
  "applyOperatorAction",
  "getIncidentLog",
  "__reset",
]);

interface RpcBody {
  method: string;
  args: unknown[];
  address?: Address | null; // реальный адрес кошелька (или dev-адрес) — личность запроса
  failMode?: boolean;
}

function json(payload: unknown, status = 200): Response {
  return new Response(encode(payload), { status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request): Promise<Response> {
  let body: RpcBody;
  try {
    body = decode<RpcBody>(await req.text());
  } catch {
    return json({ ok: false, error: { code: "BAD_BODY", message: "Невалидное тело запроса" } }, 400);
  }

  const store = getStore();
  // Per-request: личность (адрес) и инъекция ошибок от клиента; на сервере латентность не нужна.
  store.__setLatencyScale(0);
  store.__setAddress(body.address ?? null);
  store.__setFailMode(Boolean(body.failMode));

  // Спец-метод: приём ончейн-доната по подписи (сервер валидирует из цепочки, см. server/ingest.ts).
  if (body.method === "ingestSignature") {
    const sig = body.args?.[0];
    if (typeof sig !== "string") {
      return json({ ok: false, error: { code: "BAD_ARGS", message: "нужна signature" } }, 400);
    }
    const result = await ingestSignature(store, sig);
    return json({ ok: true, result });
  }

  if (!ALLOWED.has(body.method)) {
    return json(
      { ok: false, error: { code: "BAD_METHOD", message: `Метод не разрешён: ${body.method}` } },
      400,
    );
  }

  const fn = (store as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined>)[body.method];
  if (typeof fn !== "function") {
    return json(
      { ok: false, error: { code: "BAD_METHOD", message: `Метод не найден: ${body.method}` } },
      400,
    );
  }

  try {
    const result = await fn.apply(store, body.args ?? []);
    return json({ ok: true, result });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return json({ ok: false, error: { code: err.code ?? "ERROR", message: err.message ?? String(e) } });
  }
}
