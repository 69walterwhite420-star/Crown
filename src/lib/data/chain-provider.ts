import type { WalletContextState } from "@solana/wallet-adapter-react";
import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  ACTIVATION_FEE_MICRO,
  DEVNET_RPC,
  DEVNET_USDC_MINT,
  ESCROW_PROGRAM_ID,
  SIWS_STORAGE_KEY,
  TREASURY_OWNER,
} from "../chain/config";
import {
  buildActivationInstructions,
  buildDonationInstructions,
  splitAmount,
} from "../chain/donation-tx";
import {
  buildAcceptIx,
  buildCancelIx,
  buildClaimDonorIxs,
  buildClaimStreamerIxs,
  buildFundIx,
  buildMarkDoneIx,
  buildRejectIx,
  buildResolveTimeoutIx,
  decodeEscrow,
  escrowPda,
} from "../chain/escrow-tx";
import { WINDOWS } from "@/games/escrow-task/machine";
import { buildPayoutAttestationMessage, verifyPayoutAttestation } from "../chain/attestation";
import { resolveTier } from "../reputation";
import { toMicro } from "../utils";
import { ApiDataProvider } from "./api-provider";
import { hashContent, taskTextCommitment } from "./moderation";
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

/**
 * Phase 3 (yellow-paper §11.4): HYBRID. Reading Reign/realms/moderation comes from the off-chain
 * backend (the indexer feeds it), so it's delegated to `ApiDataProvider`. Writing money goes through
 * the wallet: `connect` (SIWS, gasless), `createDonation` (assemble tx 97/3 + memo + ATA, signed by
 * the wallet). The final Reign credit is done by the indexer; an optimistic result is returned here.
 *
 * The wallet is injected from the React tree (useWallet) via setWallet — the class never calls hooks.
 */
/** Uint8Array → base64 without Buffer (browser). Signature is 64 bytes — a simple implementation suffices. */
function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

// — Helpers for the 32-byte escrow seed (chain-mode game, G3a) —
const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
function fromHex(s: string): Uint8Array {
  const a = new Uint8Array(s.length >> 1);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return a;
}
function randomTaskId(): Uint8Array {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return a;
}

export class ChainDataProvider implements DataProvider {
  private api = new ApiDataProvider();
  private connection = new Connection(DEVNET_RPC, "confirmed");
  // protected: IcpDataProvider (subclass) signs governance messages with the wallet (M1).
  protected wallet: WalletContextState | null = null;
  private authedAddress: string | null = null; // address that already has a verified token
  private authing: Promise<boolean> | null = null;

  constructor() {
    // The session is tied to the CONNECTED wallet: on startup we do NOT apply the localStorage token "blindly" —
    // otherwise the UI is "half-logged-in" (the Crown form/standing are active) though the wallet isn't connected and there's nothing to sign with.
    // When the wallet connects (autoConnect or "Sign in"), the bridge calls ensureAuth → which reuses
    // the stored token WITHOUT signing again. That way the header, standing, and Crown always reflect one state.
  }

  setWallet(wallet: WalletContextState | null) {
    this.wallet = wallet;
    // The backend identity = the VERIFIED token (ensureAuth), not a bare pubkey (hole C1). We drop the session ONLY when
    // switching to a DIFFERENT connected address. "Wallet not connected" (addr === null, e.g. refresh without
    // autoConnect) must NOT drop the restored token — logout is done explicitly (__logout from the bridge).
    const addr = wallet?.publicKey?.toBase58() ?? null;
    if (addr !== null && addr !== this.authedAddress) this.clearAuth();
  }
  /** Full logout: forget the token (memory + localStorage). Called by the bridge on an EXPLICIT wallet disconnect. */
  __logout() {
    this.clearAuth();
    this.clearStoredToken();
  }
  private address(): string | null {
    return this.wallet?.publicKey?.toBase58() ?? null;
  }

  // — Authentication (SIWS): nonce from the server → signed by the wallet → session token —
  private clearAuth() {
    this.authedAddress = null;
    this.api.__setToken(null);
  }
  private loadStoredToken(address: string): string | null {
    if (typeof localStorage === "undefined") return null;
    try {
      const o = JSON.parse(localStorage.getItem(SIWS_STORAGE_KEY) ?? "null") as {
        address: string;
        token: string;
        exp: number;
      } | null;
      if (o && o.address === address && o.exp > Date.now()) return o.token;
    } catch {
      /* corrupt/empty store */
    }
    return null;
  }
  private storeToken(address: string, token: string, exp: number) {
    try {
      localStorage?.setItem(SIWS_STORAGE_KEY, JSON.stringify({ address, token, exp }));
    } catch {
      /* private mode/quota — not critical, we just go without persistence */
    }
  }
  private clearStoredToken() {
    try {
      localStorage?.removeItem(SIWS_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  /**
   * Guarantees a verified identity for the connected wallet. Idempotent: with an already-valid token
   * (in memory or localStorage) it does NOT ask for a signature again. Returns true if the state changed
   * (a reason to invalidate the query cache). Crowns don't call this method — you can crown without signing in.
   */
  async ensureAuth(): Promise<boolean> {
    const w = this.wallet;
    if (!w?.connected || !w.publicKey) {
      if (this.authedAddress) {
        this.clearAuth();
        return true;
      }
      return false;
    }
    const address = w.publicKey.toBase58();
    if (this.authedAddress === address) return false;
    if (this.authing) return this.authing;

    const p = (async () => {
      // 1. Try the stored token, but VERIFY it against the server (source of truth). Server sessions are
      //    in-memory → after a server restart/token expiry the localStorage token no longer resolves. Without this
      //    check the UI would stay "half-logged-in": the wallet is connected (address visible), but the session is empty →
      //    creator/post-registration buttons reset.
      const stored = this.loadStoredToken(address);
      if (stored) {
        this.api.__setToken(stored);
        const s = await this.api.getSession();
        if (s.address === address) {
          this.authedAddress = address;
          return true;
        }
        this.clearStoredToken(); // token expired on the server → clear it and go for a fresh signature
        this.api.__setToken(null);
      }
      // 2. Fresh SIWS: server nonce + signed by the wallet.
      if (!w.signMessage) throw new DataError("NO_SIGN", "This wallet can't sign messages.");
      const { message } = await this.api.authNonce(address);
      let sig: Uint8Array;
      try {
        sig = await w.signMessage(new TextEncoder().encode(message));
      } catch {
        // The user rejected the SIWS signature (or the wallet couldn't) — this is an EXPECTED refusal, not a crash. Disconnect
        // the wallet so the UI returns to the original "Sign in" (rather than getting stuck on "Sign in (signature)"), and do NOT rethrow
        // the error — otherwise the dev-overlay pops up and the button hangs.
        await w.disconnect?.().catch(() => {});
        this.clearAuth();
        return false;
      }
      const { token, exp } = await this.api.authVerify(address, toBase64(sig));
      this.api.__setToken(token);
      this.storeToken(address, token, exp);
      this.authedAddress = address;
      return true;
    })();
    this.authing = p;
    // The finally chain may REJECT (a server error in authNonce/authVerify) → we swallow it with .catch, otherwise
    // the unhandled rejection surfaces as the dev-overlay. The caller receives the actual error via `return p`.
    void p
      .finally(() => {
        if (this.authing === p) this.authing = null;
      })
      .catch(() => {});
    return p;
  }

  /**
   * Server ingestion of an on-chain tx with retries. In chain mode the server accepts only finalized (M2), which
   * is ~15-30s later than the client's "confirmed" — a single request would almost always return pending, and then the money
   * is gone but there's no credit/activation (there was such a bug with activation). We retry while the server signals pending.
   * 24×3s ≈ 72s comfortably covers typical finalization. Idempotent on the server side.
   */
  private async ingestWithRetry<T extends { ok: boolean; pending?: boolean }>(
    call: () => Promise<T>,
    tries = 24,
    delayMs = 3000,
  ): Promise<T> {
    let res = await call();
    for (let i = 1; i < tries && !res.ok && res.pending; i++) {
      await new Promise((r) => setTimeout(r, delayMs));
      res = await call();
    }
    return res;
  }

  // — Wallet (on-chain) —
  async getSession(): Result<Session> {
    return this.api.getSession(); // the server takes the identity from the verified token (ensureAuth)
  }
  async connect(): Result<Session> {
    const w = this.wallet;
    if (!w) throw new DataError("NO_WALLET", "Wallet not connected.");
    if (!w.connected) await w.connect();
    await this.ensureAuth(); // real SIWS: server nonce + signature verification on the backend
    return this.api.getSession();
  }
  async disconnect(): Result<void> {
    try {
      await this.api.disconnect(); // while the token is in the body, the server will invalidate it
    } catch {
      /* clear locally anyway */
    }
    this.clearAuth();
    this.clearStoredToken();
    await this.wallet?.disconnect?.();
  }

  async createDonation(input: DonationInput): Result<DonationResult> {
    const w = this.wallet;
    if (!w?.publicKey || !w.sendTransaction) throw new DataError("NO_WALLET", "Connect your wallet.");
    if (!DEVNET_USDC_MINT || !TREASURY_OWNER) {
      throw new DataError(
        "NOT_CONFIGURED",
        "NEXT_PUBLIC_DEVNET_USDC_MINT and NEXT_PUBLIC_TREASURY_OWNER are not set.",
      );
    }
    // Text preflight BEFORE signing/sending: on-chain money is irreversible (§4.2), so we catch forbidden content
    // (HARD_BLOCK) early and do NOT build the transaction — the wallet won't even ask for a signature. Profanity is allowed
    // (moderation policy); ingest re-runs moderation anyway as a backstop. No text — nothing to check.
    const text = input.text?.trim() || undefined;
    if (text) {
      const { blocked, reason } = await this.api.precheckText(text, input.channelId);
      if (blocked)
        throw new DataError(
          reason === "blocklist" ? "BLOCKED" : "TEXT_BLOCKED",
          reason === "blocklist"
            ? "This wallet is blocked on the realm from Crowns-with-messages. You can crown without text."
            : "The message didn't pass moderation (forbidden/hard content). Remove it or crown without text.",
        );
    }

    // Resolve channelId → payoutAddress via the off-chain backend.
    const list = await this.api.listChannels();
    const card = list.items.find((c) => c.channelId === input.channelId);
    const channel = card ? await this.api.getChannel(card.handle) : null;
    if (!channel) throw new DataError("NO_CHANNEL", "Realm not found or not activated.");
    this.assertPayoutAttested(channel); // H1: payout is valid only with the owner's signature — the server isn't the truth

    const amountMicro = toMicro(input.amountUSDC);
    const { fee, net } = splitAmount(amountMicro);
    const donationId = `d-${this.address()}-${list.items.length}`;
    // The text is private and off-chain; in the memo we put ONLY its hash — the server later checks the submitted text against it
    // (trustless binding, see server/ingest.ts). No text → m = null.
    const msgRef = text ? await hashContent(text) : null;
    const ix = await buildDonationInstructions(this.connection, {
      donor: w.publicKey,
      payout: new PublicKey(channel.payoutAddress),
      treasury: new PublicKey(TREASURY_OWNER),
      mint: new PublicKey(DEVNET_USDC_MINT),
      amountMicro,
      creatorId: input.channelId,
      donationId,
      msgRef,
    });
    const tx = new Transaction().add(...ix);
    tx.feePayer = w.publicKey;
    const latest = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = latest.blockhash;
    const signature = await w.sendTransaction(tx, this.connection);

    // First wait for the tx to actually land in the network (confirmed — fast).
    await this.connection.confirmTransaction({ signature, ...latest }, "confirmed");
    // We show the "Done" moment only after FINALIZATION (irreversible): the server accepts the Crown only when
    // finalized, so we poll ingestion with retries until the tx finalizes (~15-30s). Only then is the moment
    // honest — the money is gone for good, canceling (Brave "Cancel") is no longer possible. The server checks the text against the memo
    // hash and creates a message → HELD/moderation. The Reign credit has already happened by this point.
    const ingest = await this.ingestWithRetry(() => this.api.ingestSignature(signature, text));
    if (!ingest.ok) {
      throw new DataError(
        "DONATION_PENDING",
        ingest.reason ?? "The Crown isn't finalized on the network yet — refresh the page a little later.",
      );
    }

    const donation: Donation = {
      id: donationId,
      channelId: input.channelId,
      donor: w.publicKey.toBase58(),
      amount: amountMicro,
      feeAmount: fee,
      netToStreamer: net,
      txSignature: signature,
      final: true,
      ts: new Date().toISOString(),
    };
    const donorAddr = w.publicKey.toBase58();
    let standing = await this.api.getStanding(input.channelId, donorAddr);
    if (!standing) {
      const cfg = await this.api.getChannelConfig(input.channelId);
      const { tier, nextTier, progressToNext } = resolveTier(0, cfg.tiers);
      standing = {
        channelId: input.channelId,
        donor: donorAddr,
        points: 0,
        tier,
        nextTier,
        progressToNext,
        totalDonated: 0n,
      };
    }
    return { donation, standing, tierChanged: false };
  }

  // — Off-chain layer (read from the backend, fed by the indexer) → delegate to ApiDataProvider —
  getProfile(a: Address): Result<LightProfile | null> {
    return this.api.getProfile(a);
  }
  updateProfile(p: Partial<LightProfile>): Result<LightProfile> {
    return this.api.updateProfile(p);
  }
  listChannels(o?: ListOpts): Result<Page<ChannelCard>> {
    return this.api.listChannels(o);
  }
  getChannel(h: string): Result<Channel | null> {
    return this.api.getChannel(h);
  }
  getMyChannel(): Result<Channel | null> {
    return this.api.getMyChannel();
  }
  getManagedChannels(): Result<Channel[]> {
    return this.api.getManagedChannels();
  }
  getOperatorChannels(): Result<Channel[]> {
    return this.api.getOperatorChannels();
  }
  getChannelConfig(id: string): Result<ChannelConfig> {
    return this.api.getChannelConfig(id);
  }
  /**
   * H1: creating a realm in chain mode immediately locks the payout with the owner wallet's ed25519 signature.
   * From that point the server is not the source of truth for the payout address: the signature is verified by every donor's client
   * (assertPayoutAttested) and by ingest at credit time. The wallet will show readable message text (not a transaction).
   */
  async createChannel(i: CreateChannelInput): Result<Channel> {
    const payoutAttestation = await this.signPayoutAttestation(i.payoutAddress);
    return this.api.createChannel({ ...i, payoutAttestation });
  }
  /** H1: lock the payout of an existing realm (created before attestations) — sign and send to the server. */
  async attestPayout(channelId: string): Result<Channel> {
    const mine = await this.api.getMyChannel();
    if (!mine || mine.id !== channelId)
      throw new DataError("NOT_OWNER", "Only the realm owner can sign the payout address.");
    return this.api.attestPayout(channelId, await this.signPayoutAttestation(mine.payoutAddress));
  }
  private async signPayoutAttestation(payout: string): Promise<string> {
    const w = this.wallet;
    if (!w?.publicKey || !w.signMessage)
      throw new DataError("NO_SIGN", "This wallet can't sign messages.");
    const msg = buildPayoutAttestationMessage(w.publicKey.toBase58(), payout);
    return toBase64(await w.signMessage(new TextEncoder().encode(msg)));
  }
  /** Client-side H1 check: we don't build a money tx to a payout not signed by the realm owner's key. */
  private assertPayoutAttested(channel: Channel): void {
    if (
      !channel.payoutAttestation ||
      !verifyPayoutAttestation(
        channel.ownerAddress,
        channel.payoutAddress,
        channel.payoutAttestation,
      )
    )
      throw new DataError(
        "PAYOUT_UNATTESTED",
        "The realm hasn't confirmed its payout address with the owner's signature — sending money is blocked (protection against address swapping).",
      );
  }
  /**
   * Realm activation = an on-chain fee (~$2 USDC owner→treasury) + memo `{act}`. The server itself pulls the tx
   * from the chain, checks payer === owner and the amount threshold, and moves the realm to ACTIVE (see ingestActivation).
   * An off-chain flip is forbidden in chain mode (CHAIN_FORBIDDEN), so we go strictly through the wallet.
   */
  async activateChannel(id: string): Result<Channel> {
    const w = this.wallet;
    if (!w?.publicKey || !w.sendTransaction) throw new DataError("NO_WALLET", "Connect your wallet.");
    if (!DEVNET_USDC_MINT || !TREASURY_OWNER) {
      throw new DataError(
        "NOT_CONFIGURED",
        "NEXT_PUBLIC_DEVNET_USDC_MINT and NEXT_PUBLIC_TREASURY_OWNER are not set.",
      );
    }
    await this.ensureAuth(); // the owner activates their own realm → a verified identity is needed for getMyChannel

    const ix = await buildActivationInstructions(this.connection, {
      payer: w.publicKey,
      treasury: new PublicKey(TREASURY_OWNER),
      mint: new PublicKey(DEVNET_USDC_MINT),
      channelId: id,
      feeMicro: ACTIVATION_FEE_MICRO,
    });
    const tx = new Transaction().add(...ix);
    tx.feePayer = w.publicKey;
    const latest = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = latest.blockhash;
    const signature = await w.sendTransaction(tx, this.connection);

    await this.connection.confirmTransaction({ signature, ...latest }, "confirmed");
    // The server accepts the fee only when finalized (M2) — we retry ingestion until the tx finalizes (~15-30s),
    // otherwise the fee is paid but the realm isn't activated. Blocking: the user waits on the activation screen.
    const res = await this.ingestWithRetry(() => this.api.ingestActivation(signature));
    if (!res.ok)
      throw new DataError("ACTIVATION_FAILED", res.reason ?? "Activation fee not accepted.");

    const channel = await this.api.getMyChannel();
    if (!channel) throw new DataError("NO_CHANNEL", "Realm not found after activation.");
    return channel;
  }
  updateChannelConfig(id: string, p: ConfigPatch): Result<ChannelConfig> {
    return this.api.updateChannelConfig(id, p);
  }
  getStanding(id: string, d: Address): Result<ViewerStanding | null> {
    return this.api.getStanding(id, d);
  }
  getLeaderboard(id: string, p: LeaderboardPeriod): Result<LeaderboardEntry[]> {
    return this.api.getLeaderboard(id, p);
  }
  getDonorOverview(a: Address): Result<DonorOverview> {
    return this.api.getDonorOverview(a);
  }
  homeFeed(): Result<HomeFeed> {
    return this.api.homeFeed();
  }
  listDonations(id: string, o?: ListOpts): Result<Page<Donation>> {
    return this.api.listDonations(id, o);
  }
  getModerationQueue(id: string): Result<MessageRef[]> {
    return this.api.getModerationQueue(id);
  }
  setMessageState(id: string, s: "SHOWN" | "HIDDEN"): Result<MessageRef> {
    return this.api.setMessageState(id, s);
  }
  hideDonorMessages(channelId: string, donor: string): Result<{ hidden: number }> {
    return this.api.hideDonorMessages(channelId, donor);
  }
  reportMessage(messageId: string, reason?: string): Result<{ reports: number; hidden: boolean }> {
    return this.api.reportMessage(messageId, reason);
  }
  getChannelBlocklist(id: string): Result<ChannelBlock[]> {
    return this.api.getChannelBlocklist(id);
  }
  addChannelBlock(id: string, a: Address, r?: string): Result<ChannelBlock> {
    return this.api.addChannelBlock(id, a, r);
  }
  removeChannelBlock(id: string, a: Address): Result<void> {
    return this.api.removeChannelBlock(id, a);
  }
  getMyChannelBlock(id: string): Result<ChannelBlock | null> {
    return this.api.getMyChannelBlock(id);
  }
  getOperatorQueue(): Result<IncidentLog[]> {
    return this.api.getOperatorQueue();
  }
  applyOperatorAction(a: Omit<OperatorAction, "id" | "ts" | "byOperator">): Result<OperatorAction> {
    return this.api.applyOperatorAction(a);
  }

  // — Mini-games (game-bus, ADR 0016) —
  // For escrow-task (ADR 0017): money operations really move USDC through the on-chain program with the connected
  // wallet (the program itself checks that the signer is the right actor: donor/streamer/recipient), then
  // we update the off-chain mirror via `api` (which also handles text moderation and Reign banking). Disputes (M2,
  // ADR 0021) are run by the canister arbiter, its outcome executed by its threshold resolver — routed in IcpDataProvider;
  // in pure chain mode (without icp) a dispute over a chain task does NOT carry its outcome onto the chain. Reads come from the backend.

  /** Assemble a tx from instructions, sign with the connected wallet, wait for confirmed. Return the signature. */
  private async sendTx(ixs: TransactionInstruction[]): Promise<string> {
    const w = this.wallet;
    if (!w?.publicKey || !w.sendTransaction) throw new DataError("NO_WALLET", "Connect your wallet.");
    const tx = new Transaction().add(...ixs);
    tx.feePayer = w.publicKey;
    const latest = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = latest.blockhash;
    const sig = await w.sendTransaction(tx, this.connection);
    await this.connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
    return sig;
  }

  /** The task's 32-byte escrow seed (from the off-chain mirror) for rebuilding the PDA in later operations. */
  private async escrowTaskIdOf(channelId: string, taskId: unknown): Promise<Uint8Array> {
    const task = (await this.api.gameQuery({
      gameId: "escrow-task",
      channelId,
      op: "get",
      payload: { taskId },
    })) as { escrowTaskId?: string } | null;
    if (!task?.escrowTaskId)
      throw new DataError("NO_ESCROW", "The task has no on-chain escrow (created outside chain mode?).");
    return fromHex(task.escrowTaskId);
  }

  async gameAction(req: GameRequest): Result<unknown> {
    if (req.gameId !== "escrow-task") return this.api.gameAction(req);
    const w = this.wallet;
    if (!w?.publicKey) throw new DataError("NO_WALLET", "Connect your wallet.");
    if (!ESCROW_PROGRAM_ID || !DEVNET_USDC_MINT) {
      throw new DataError(
        "NOT_CONFIGURED",
        "The escrow program address or USDC mint is not set (NEXT_PUBLIC_ESCROW_PROGRAM_ID/USDC).",
      );
    }
    const programId = new PublicKey(ESCROW_PROGRAM_ID);
    const mint = new PublicKey(DEVNET_USDC_MINT);
    const p = (req.payload ?? {}) as Record<string, unknown>;

    switch (req.op) {
      case "create": {
        const amountStr = String(p.amount ?? "");
        if (!/^\d+$/.test(amountStr) || BigInt(amountStr) <= 0n)
          throw new DataError("BAD_AMOUNT", "A positive amount is required (micro-USDC).");
        // Realm levers BEFORE signing/sending (parity with the server-side create): escrow is irreversible — BELOW_MIN/
        // TOO_LONG after fund would freeze the money until the refund timeout. The server checks again (the truth is there).
        const text = typeof p.text === "string" ? p.text.trim() : "";
        const cfg = await this.api.getChannelConfig(req.channelId);
        const minTask =
          cfg.minDonationWithText > cfg.minDonation ? cfg.minDonationWithText : cfg.minDonation;
        if (BigInt(amountStr) < minTask)
          throw new DataError("BELOW_MIN", "The amount is below the realm's minimum for tasks.");
        if (text.length > cfg.messageMaxLen)
          throw new DataError("TOO_LONG", "The task text exceeds the realm's limit.");
        // §10 threshold BEFORE signing (parity with the server-side create): escrow is irreversible — a LOW_REP refusal AFTER
        // fund would freeze the donor's money until the refund timeout (yellow-paper §18.3-5, closed).
        if (cfg.minReputationToTask > 0) {
          const st = await this.api.getStanding(req.channelId, w.publicKey.toBase58());
          if ((st?.points ?? 0) < cfg.minReputationToTask)
            throw new DataError(
              "LOW_REP",
              `Tasks on this realm are available from ${cfg.minReputationToTask} Reign points — earn them with regular Crowns.`,
            );
        }
        // Moderation BEFORE signing/sending: on-chain money is irreversible — we catch forbidden content early, otherwise
        // the escrow would be funded for a task that the off-chain create would then reject.
        if (text) {
          // kind: "task" → the preflight judges by the SAME strict policy as the server-side create (ADR 0017): on-chain
          // money is irreversible, so an illegal task must be cut off BEFORE funding, not after.
          const { blocked, reason } = await this.api.precheckText(text, req.channelId, "task");
          if (blocked)
            throw new DataError(
              reason === "blocklist" ? "BLOCKED" : "TEXT_BLOCKED",
              reason === "blocklist"
                ? "The wallet is blocked on the realm for messages."
                : "The task text didn't pass moderation (forbidden/dangerous content).",
            );
        }
        // channelId → the streamer's payout address (via the off-chain backend, as in createDonation).
        const list = await this.api.listChannels();
        const card = list.items.find((c) => c.channelId === req.channelId);
        const channel = card ? await this.api.getChannel(card.handle) : null;
        if (!channel) throw new DataError("NO_CHANNEL", "Realm not found or not activated.");
        this.assertPayoutAttested(channel); // H1: escrow fund is also money to the payout, same check
        const rawMs = typeof p.executionMs === "number" ? p.executionMs : 24 * 3600 * 1000;
        // Clamp the submission window to executionMin (the same floor as machine.createTask; executionMin > grace, ESC-17)
        // — otherwise fund reverts on the on-chain require, and the off-chain deadline would diverge from the on-chain done_deadline. The same
        // value goes into the off-chain create → the chain and the mirror stay consistent.
        const executionMs = Math.max(rawMs, WINDOWS.executionMin);
        // CR-4: task_id = SHA-256(nonce ‖ text) — the on-chain escrow seed BECOMES a commitment to the task text
        // (like memo.m for Crowns). The operator can neither swap nor quietly hide the text that the
        // jury judges: anyone can recompute the commitment from (text, nonce) and check it against the on-chain address. The nonce is stored off-chain.
        const textNonce = toHex(randomTaskId()).slice(0, 32); // 16 bytes of salt (kills brute-forcing low-entropy ones)
        const taskIdHex = await taskTextCommitment(text, textNonce);
        const taskId = fromHex(taskIdHex);
        const ix = await buildFundIx({
          programId,
          donor: w.publicKey,
          streamer: new PublicKey(channel.payoutAddress),
          mint,
          taskId,
          amount: BigInt(amountStr),
          executionWindow: BigInt(Math.floor(executionMs / 1000)),
        });
        const fundTx = await this.sendTx([ix]);
        return this.api.gameAction({
          ...req,
          payload: { ...p, executionMs, escrowTaskId: taskIdHex, fundTx, textNonce },
        });
      }

      // "Accept" now GOES to the chain (ESC-19): without an on-chain accept you can't mark_done/claim, and via
      // the accept tx the indexer reveals the text. The streamer pays gas; the text is published — that's the seam.
      case "accept":
      case "reject":
      case "markDone":
      case "cancel": {
        const taskId = await this.escrowTaskIdOf(req.channelId, p.taskId);
        const ix =
          req.op === "accept"
            ? buildAcceptIx(programId, w.publicKey, taskId)
            : req.op === "reject"
              ? buildRejectIx(programId, w.publicKey, taskId)
              : req.op === "markDone"
                ? buildMarkDoneIx(programId, w.publicKey, taskId)
                : buildCancelIx(programId, w.publicKey, taskId);
        await this.sendTx([ix]);
        return this.api.gameAction(req);
      }

      case "claim": {
        const taskId = await this.escrowTaskIdOf(req.channelId, p.taskId);
        const escrow = escrowPda(programId, taskId);
        const info = await this.connection.getAccountInfo(escrow);
        if (info) {
          const me = w.publicKey; // the guard's narrowing doesn't survive into closures — pin it in a const
          const acc = decodeEscrow(info.data);
          const claimStreamerIxs = () =>
            buildClaimStreamerIxs(this.connection, {
              programId,
              streamer: me,
              donor: acc.donor,
              treasury: acc.treasury,
              mint,
              taskId,
            });
          const claimDonorIxs = () =>
            buildClaimDonorIxs(this.connection, { programId, donor: me, mint, taskId });

          if (acc.resolution === 1) {
            await this.sendTx(await claimStreamerIxs()); // ToStreamer (already resolved)
          } else if (acc.resolution === 2) {
            await this.sendTx(await claimDonorIxs()); // ToDonor (already resolved)
          } else {
            // Unresolved → auto-resolution by timeout + claim in ONE transaction (one confirmation/gas
            // instead of two). We predict the side from the on-chain state (the same that resolve_timeout would set):
            // Done → to the streamer; Pending/Accepted-overdue → to the donor. Not ripe yet / dispute open → the program
            // reverts the whole tx (claim opens after the window or after the canister arbiter's verdict, M2).
            const claimIxs = acc.state === 2 ? await claimStreamerIxs() : await claimDonorIxs();
            await this.sendTx([buildResolveTimeoutIx(programId, me, taskId), ...claimIxs]);
          }
        }
        // Off-chain settle banks the Reign (DONATION on to_streamer; a refund gives no points) — the brain is off-chain.
        return this.api.gameAction(req);
      }

      // M2 (ADR 0021): manual on-chain resolver actions (markDisputed/resolveDispute) are REMOVED —
      // a chain task's dispute is run by the canister arbiter, the verdict executed by the threshold resolver
      // (IcpDataProvider.gameAction routes raiseDispute/vote to the canister).

      default:
        // raiseDispute, vote, and the rest — the server's off-chain mirror. For chain tasks in icp mode this
        // isn't reached: IcpDataProvider intercepts dispute operations and routes them to the canister arbiter (M2).
        return this.api.gameAction(req);
    }
  }

  gameQuery(req: GameRequest): Result<unknown> {
    return this.api.gameQuery(req);
  }
}
