import { decode, encode } from "@/lib/data/codec";
import type { IdentityKey } from "@/lib/data/fixtures";
import { getStore } from "@/server/store";

export const dynamic = "force-dynamic";

// Белый список разрешённых методов (все методы DataProvider, кроме subscribeOverlay, + dev-reset).
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
  identity?: IdentityKey;
  failMode?: boolean;
}

function json(payload: unknown, status = 200): Response {
  return new Response(encode(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: Request): Promise<Response> {
  let body: RpcBody;
  try {
    body = decode<RpcBody>(await req.text());
  } catch {
    return json({ ok: false, error: { code: "BAD_BODY", message: "Невалидное тело запроса" } }, 400);
  }

  if (!ALLOWED.has(body.method)) {
    return json(
      { ok: false, error: { code: "BAD_METHOD", message: `Метод не разрешён: ${body.method}` } },
      400,
    );
  }

  const store = getStore();
  // Per-request: личность и инъекция ошибок приходят от клиента; на сервере латентность не нужна.
  store.__setLatencyScale(0);
  store.__setIdentity(body.identity ?? "guest");
  store.__setFailMode(Boolean(body.failMode));

  const fn = (store as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined>)[
    body.method
  ];
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
