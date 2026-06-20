import { decode, encode } from "./codec";
import type { IdentityKey } from "./fixtures";
import { DataError, type DataProvider, type Result } from "./provider";
import type {
  Address,
  Channel,
  ChannelBlock,
  ChannelCard,
  ChannelConfig,
  ConfigPatch,
  CreateChannelInput,
  Donation,
  DonationInput,
  DonationResult,
  IncidentLog,
  LeaderboardEntry,
  LeaderboardPeriod,
  LightProfile,
  ListOpts,
  MessageRef,
  OperatorAction,
  OverlayEvent,
  Page,
  Session,
  ViewerStanding,
} from "./types";

interface RpcResponse<T> {
  ok: boolean;
  result?: T;
  error?: { code: string; message: string };
}

/**
 * Фаза 2: реализация DataProvider поверх HTTP (RPC-мост /api/v1/rpc). Экраны не знают, что под ними
 * теперь сервер. Личность и MOCK_FAIL мирроятся локально и шлются с каждым запросом → dev-тулбар и
 * /connect работают и под `api`. Оверлей-подписка — заглушка (SSE — дальнейший шаг).
 */
export class ApiDataProvider implements DataProvider {
  private identityKey: IdentityKey = "guest";
  private failMode = false;

  private async rpc<T>(method: string, args: unknown[]): Promise<T> {
    let res: Response;
    try {
      res = await fetch("/api/v1/rpc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: encode({ method, args, identity: this.identityKey, failMode: this.failMode }),
      });
    } catch {
      throw new DataError("NETWORK", "Сеть недоступна или сервер не отвечает.");
    }
    const text = await res.text();
    let payload: RpcResponse<T>;
    try {
      payload = decode<RpcResponse<T>>(text);
    } catch {
      // не-JSON (framework-500 → HTML, прокси-ошибка и т.п.)
      throw new DataError("BAD_RESPONSE", `Сервер вернул неожиданный ответ (HTTP ${res.status}).`);
    }
    if (!payload.ok) {
      throw new DataError(payload.error?.code ?? "RPC_ERROR", payload.error?.message ?? "Ошибка API");
    }
    return payload.result as T;
  }

  // — Сессия / идентичность —
  getSession(): Result<Session> {
    return this.rpc("getSession", []);
  }
  connect(): Result<Session> {
    // Личность durable у клиента (шлётся с каждым запросом), поэтому зеркало надо обновить здесь,
    // иначе следующий RPC отправит прежний identity и откатит серверную сессию.
    this.identityKey = "donorA";
    return this.rpc("connect", []);
  }
  disconnect(): Result<void> {
    this.identityKey = "guest";
    return this.rpc("disconnect", []);
  }
  getProfile(address: Address): Result<LightProfile | null> {
    return this.rpc("getProfile", [address]);
  }
  updateProfile(patch: Partial<LightProfile>): Result<LightProfile> {
    return this.rpc("updateProfile", [patch]);
  }

  // — Дискавери / каналы —
  listChannels(opts?: ListOpts): Result<Page<ChannelCard>> {
    return this.rpc("listChannels", [opts]);
  }
  getChannel(handle: string): Result<Channel | null> {
    return this.rpc("getChannel", [handle]);
  }
  getMyChannel(): Result<Channel | null> {
    return this.rpc("getMyChannel", []);
  }
  getChannelConfig(channelId: string): Result<ChannelConfig> {
    return this.rpc("getChannelConfig", [channelId]);
  }
  createChannel(input: CreateChannelInput): Result<Channel> {
    return this.rpc("createChannel", [input]);
  }
  activateChannel(channelId: string): Result<Channel> {
    return this.rpc("activateChannel", [channelId]);
  }
  updateChannelConfig(channelId: string, patch: ConfigPatch): Result<ChannelConfig> {
    return this.rpc("updateChannelConfig", [channelId, patch]);
  }

  // — Репутация / статус —
  getStanding(channelId: string, donor: Address): Result<ViewerStanding | null> {
    return this.rpc("getStanding", [channelId, donor]);
  }
  getLeaderboard(channelId: string, period: LeaderboardPeriod): Result<LeaderboardEntry[]> {
    return this.rpc("getLeaderboard", [channelId, period]);
  }

  // — Донаты —
  createDonation(input: DonationInput): Result<DonationResult> {
    return this.rpc("createDonation", [input]);
  }
  listDonations(channelId: string, opts?: ListOpts): Result<Page<Donation>> {
    return this.rpc("listDonations", [channelId, opts]);
  }

  // — Модерация —
  getModerationQueue(channelId: string): Result<MessageRef[]> {
    return this.rpc("getModerationQueue", [channelId]);
  }
  setMessageState(messageId: string, state: "SHOWN" | "HIDDEN"): Result<MessageRef> {
    return this.rpc("setMessageState", [messageId, state]);
  }

  // — Канальный блок-лист —
  getChannelBlocklist(channelId: string): Result<ChannelBlock[]> {
    return this.rpc("getChannelBlocklist", [channelId]);
  }
  addChannelBlock(channelId: string, address: Address, reason?: string): Result<ChannelBlock> {
    return this.rpc("addChannelBlock", [channelId, address, reason]);
  }
  removeChannelBlock(channelId: string, address: Address): Result<void> {
    return this.rpc("removeChannelBlock", [channelId, address]);
  }

  // — Оператор / T&S —
  getOperatorQueue(): Result<IncidentLog[]> {
    return this.rpc("getOperatorQueue", []);
  }
  applyOperatorAction(
    action: Omit<OperatorAction, "id" | "ts" | "byOperator">,
  ): Result<OperatorAction> {
    return this.rpc("applyOperatorAction", [action]);
  }
  getIncidentLog(opts?: ListOpts): Result<Page<IncidentLog>> {
    return this.rpc("getIncidentLog", [opts]);
  }

  // — Оверлей — живой поток через SSE (GET /api/v1/overlay/[channelId]).
  subscribeOverlay(channelId: string, cb: (e: OverlayEvent) => void): () => void {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return () => {};
    const es = new EventSource(`/api/v1/overlay/${encodeURIComponent(channelId)}`);
    es.onmessage = (ev) => {
      try {
        cb(decode<OverlayEvent>(ev.data));
      } catch {
        // игнор битых кадров
      }
    };
    es.onerror = () => {
      // Транзиентный обрыв: EventSource переподключается сам. Явный хук — чтобы ошибка не всплывала.
    };
    return () => es.close();
  }

  // — Dev-контролы (зеркало клиента; identity/failMode шлются с каждым запросом) —
  __setIdentity(key: IdentityKey) {
    this.identityKey = key;
  }
  __getIdentityKey(): IdentityKey {
    return this.identityKey;
  }
  __setFailMode(on: boolean) {
    this.failMode = on;
  }
  __getFailMode(): boolean {
    return this.failMode;
  }
  __setLatencyScale(_scale: number) {
    // латентность задаётся сервером; на клиенте no-op
  }
  __reset() {
    this.identityKey = "guest";
    this.failMode = false;
    void this.rpc("__reset", []);
  }
}
