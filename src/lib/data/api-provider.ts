import { decode, encode } from "./codec";
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
  DonorOverview,
  GameRequest,
  HomeFeed,
  IncidentLog,
  LeaderboardEntry,
  LeaderboardPeriod,
  LightProfile,
  ListOpts,
  MessageRef,
  OperatorAction,
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
 * Phase 2: a DataProvider implementation over HTTP (the RPC bridge /api/v1/rpc). Screens don't know
 * there's now a server under them. Identity and MOCK_FAIL are mirrored locally and sent with every request → the dev toolbar
 * works under `api` too. The overlay subscription is a stub (SSE is a later step).
 */
export class ApiDataProvider implements DataProvider {
  private address: Address | null = null; // DEV identity (mock/api without a wallet); in prod the server ignores it
  private token: string | null = null; // session token after verifying the SIWS signature — the real identity
  private failMode = false;

  private async rpc<T>(method: string, args: unknown[]): Promise<T> {
    let res: Response;
    try {
      res = await fetch("/api/v1/rpc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: encode({
          method,
          args,
          token: this.token,
          address: this.address,
          failMode: this.failMode,
        }),
      });
    } catch {
      throw new DataError("NETWORK", "Network is unavailable or the server isn't responding.");
    }
    const text = await res.text();
    let payload: RpcResponse<T>;
    try {
      payload = decode<RpcResponse<T>>(text);
    } catch {
      // non-JSON (framework-500 → HTML, proxy error, etc.)
      throw new DataError("BAD_RESPONSE", `The server returned an unexpected response (HTTP ${res.status}).`);
    }
    if (!payload.ok) {
      throw new DataError(
        payload.error?.code ?? "RPC_ERROR",
        payload.error?.message ?? "API error",
      );
    }
    return payload.result as T;
  }

  // — Session / identity —
  getSession(): Result<Session> {
    return this.rpc("getSession", []);
  }
  connect(): Result<Session> {
    // The address is set from outside (wallet/dev) via __setAddress; connect returns the session for it.
    return this.rpc("connect", []);
  }
  disconnect(): Result<void> {
    const p = this.rpc<void>("disconnect", []); // while the token is still in the body — the server will revoke it
    this.address = null;
    this.token = null;
    return p;
  }
  /** Ingest an on-chain crown by signature (the server validates it from the chain). Outside DataProvider — for chain. */
  ingestSignature(
    signature: string,
    text?: string,
  ): Promise<{ ok: boolean; pending?: boolean; reason?: string; points?: number }> {
    return this.rpc("ingestSignature", [signature, text]);
  }
  /** Ingest the on-chain activation charge by signature (the server validates it from the chain). Outside DataProvider — for chain. */
  ingestActivation(
    signature: string,
  ): Promise<{ ok: boolean; pending?: boolean; reason?: string }> {
    return this.rpc("ingestActivation", [signature]);
  }
  /** Preflight the crown text BEFORE sending: blocked on HARD_BLOCK (content) or the realm blocklist. Outside DataProvider. */
  precheckText(
    text: string,
    channelId?: string,
    kind: "message" | "task" = "message",
  ): Promise<{ blocked: boolean; reason?: "content" | "blocklist" }> {
    return this.rpc("precheckText", [text, channelId, kind]);
  }
  /** SIWS step 1: get a nonce + the canonical message to sign. Outside DataProvider — for chain. */
  authNonce(address: Address): Promise<{ nonce: string; message: string }> {
    return this.rpc("__authNonce", [address]);
  }
  /** SIWS step 3: submit the signature, get a session token. Outside DataProvider — for chain. */
  authVerify(address: Address, signatureB64: string): Promise<{ token: string; exp: number }> {
    return this.rpc("__authVerify", [address, signatureB64]);
  }
  getProfile(address: Address): Result<LightProfile | null> {
    return this.rpc("getProfile", [address]);
  }
  updateProfile(patch: Partial<LightProfile>): Result<LightProfile> {
    return this.rpc("updateProfile", [patch]);
  }

  // — Discovery / realms —
  listChannels(opts?: ListOpts): Result<Page<ChannelCard>> {
    return this.rpc("listChannels", [opts]);
  }
  getChannel(handle: string): Result<Channel | null> {
    return this.rpc("getChannel", [handle]);
  }
  getMyChannel(): Result<Channel | null> {
    return this.rpc("getMyChannel", []);
  }
  getManagedChannels(): Result<Channel[]> {
    return this.rpc("getManagedChannels", []);
  }
  getOperatorChannels(): Result<Channel[]> {
    return this.rpc("getOperatorChannels", []);
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
  attestPayout(channelId: string, signatureB64?: string): Result<Channel> {
    return this.rpc("attestPayout", [channelId, signatureB64]);
  }

  // — Reign / status —
  getStanding(channelId: string, donor: Address): Result<ViewerStanding | null> {
    return this.rpc("getStanding", [channelId, donor]);
  }
  getLeaderboard(channelId: string, period: LeaderboardPeriod): Result<LeaderboardEntry[]> {
    return this.rpc("getLeaderboard", [channelId, period]);
  }
  getDonorOverview(address: Address): Result<DonorOverview> {
    return this.rpc("getDonorOverview", [address]);
  }
  homeFeed(): Result<HomeFeed> {
    return this.rpc("homeFeed", []);
  }

  // — Crowns —
  createDonation(input: DonationInput): Result<DonationResult> {
    return this.rpc("createDonation", [input]);
  }
  listDonations(channelId: string, opts?: ListOpts): Result<Page<Donation>> {
    return this.rpc("listDonations", [channelId, opts]);
  }

  // — Moderation —
  getModerationQueue(channelId: string): Result<MessageRef[]> {
    return this.rpc("getModerationQueue", [channelId]);
  }
  setMessageState(messageId: string, state: "SHOWN" | "HIDDEN"): Result<MessageRef> {
    return this.rpc("setMessageState", [messageId, state]);
  }
  hideDonorMessages(channelId: string, donor: Address): Result<{ hidden: number }> {
    return this.rpc("hideDonorMessages", [channelId, donor]);
  }
  reportMessage(messageId: string, reason?: string): Result<{ reports: number; hidden: boolean }> {
    return this.rpc("reportMessage", [messageId, reason]);
  }

  // — Realm blocklist —
  getChannelBlocklist(channelId: string): Result<ChannelBlock[]> {
    return this.rpc("getChannelBlocklist", [channelId]);
  }
  addChannelBlock(channelId: string, address: Address, reason?: string): Result<ChannelBlock> {
    return this.rpc("addChannelBlock", [channelId, address, reason]);
  }
  removeChannelBlock(channelId: string, address: Address): Result<void> {
    return this.rpc("removeChannelBlock", [channelId, address]);
  }
  getMyChannelBlock(channelId: string): Result<ChannelBlock | null> {
    return this.rpc("getMyChannelBlock", [channelId]);
  }

  // — Operator / T&S —
  getOperatorQueue(): Result<IncidentLog[]> {
    return this.rpc("getOperatorQueue", []);
  }
  applyOperatorAction(
    action: Omit<OperatorAction, "id" | "ts" | "byOperator">,
  ): Result<OperatorAction> {
    return this.rpc("applyOperatorAction", [action]);
  }

  // — Mini-games (game-bus, ADR 0016) —
  gameAction(req: GameRequest): Result<unknown> {
    return this.rpc("gameAction", [req]);
  }
  gameQuery(req: GameRequest): Result<unknown> {
    return this.rpc("gameQuery", [req]);
  }

  // — Session address (wallet/dev) + dev controls; sent with every request —
  __setAddress(address: Address | null) {
    this.address = address;
  }
  __getAddress(): Address | null {
    return this.address;
  }
  /** The verified session token (set by the chain layer after SIWS). */
  __setToken(token: string | null) {
    this.token = token;
  }
  __getToken(): string | null {
    return this.token;
  }
  __setFailMode(on: boolean) {
    this.failMode = on;
  }
  __getFailMode(): boolean {
    return this.failMode;
  }
  __setLatencyScale(_scale: number) {
    // latency is set by the server; a no-op on the client
  }
  __reset() {
    this.address = null;
    this.token = null;
    this.failMode = false;
    void this.rpc("__reset", []);
  }
}
