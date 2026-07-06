/**
 * Game-bus (ADR 0016): one shared "pipe" for ALL mini-games, so the `DataProvider` interface doesn't grow for
 * every game. The provider calls `dispatchGame`; each game registers its own handlers in `GAME_HANDLERS`.
 *
 * Dependencies are one-directional: the bus does NOT import the core (`lib/`) — only primitives — and does NOT know
 * about specific games (only id strings). So there are no cycles and no "core knows about a game". Handlers live in
 * `src/games/<id>/` and handle their own operations; type safety is restored by typed hooks in the module.
 */

/** Access to THIS game's state slice specifically. The game owns the state shape; the core stores it opaquely. */
export interface GameStateSlice {
  get<T = unknown>(): T | undefined;
  set(value: unknown): void;
}

/**
 * A reputation-ledger entry from a game (ADR 0015). The provider banks it as a `LedgerEvent` on the context's
 * `channelId`. `address` — whose reputation it concerns (donor/dispute initiator). Money provenance — as a micro string.
 */
export interface GameLedgerEntry {
  address: string;
  type: "DONATION" | "GAME" | "DISPUTE_WON" | "DISPUTE_LOST" | "REFUND";
  pointsDelta: number;
  amount?: string;
}

/**
 * The context the bus gives a handler: identity, channel, time, an id generator, its own state slice, and
 * NARROW bridges into the core (reputation at a moment + a ledger entry; ADR 0015). The provider implements the bridges —
 * the game handler stays above the core and doesn't reach into the store directly.
 */
export interface GameContext {
  /** Verified address of the caller (or null if not signed in). */
  identity: string | null;
  channelId: string;
  /** Channel owner (streamer) — to authorize actions like "Accept"/"Done". */
  channelOwner: string | null;
  /** Channel's payout address (the on-chain money recipient). Needed to bind the escrow to the channel (ESC-6). */
  channelPayout: string | null;
  /** H1: the channel payout is confirmed by the owner's ed25519 signature (verifyPayoutAttestation passed). The
   *  provider precomputes it (like isChannelManager). We don't bind a chain escrow to an UNconfirmed payout — a
   *  server-side fail-closed guard, mirroring ingest.ts, so the task's money doesn't go to a possibly-swapped address. */
  channelPayoutAttested: boolean;
  /** The caller is a channel manager (owner or a moderator from config): sees the task's private text (§4.6). */
  isChannelManager: boolean;
  /** Minimum amount for a task-donation, micro-USDC as a string: a task = a donation with text, the larger of the
   *  channel's minDonation/minDonationWithText applies (spec §10 — a streamer lever). Checked in create (BELOW_MIN). */
  minTaskAmountMicro: string;
  /** Min reputation (points) to submit a task (§10 streamer lever) — gated in create (LOW_REP). 0 = no threshold. */
  minReputationToTask: number;
  /** Min reputation (points) to raise a dispute (§10 streamer lever) — gated in raiseDispute (LOW_REP). Gates the
   *  RIGHT to raise a dispute, not the vote weight or the outcome. 0 = no threshold. */
  minReputationToDispute: number;
  /** Channel text-length limit (messageMaxLen) — applied to the task text, like donation messages (TOO_LONG, B4). */
  textMaxLen: number;
  /** ISO timestamp for "now" from the store (deterministic in tests via override). */
  now: () => string;
  /** A new unique id (for game entities being created). */
  newId: () => string;
  /** This game's state (a slice opaque to the core). */
  state: GameStateSlice;
  /** Weight = the address's points in this channel as of `asOf` (a snapshot; computePointsAsOf). The operator does
   *  not edit reputation (CR-1) → the weight is honest; punishing a violator is a wallet/channel block, not editing the number. */
  reputationAsOf: (address: string, asOf: string) => number;
  /** Bank reputation effects into the channel's ledger (ADR 0015). */
  bankLedger: (entries: GameLedgerEntry[]) => void;
  /** Text moderation (a game's UGC): a verdict. HARD_BLOCK → forbidden/dangerous content, not let through. */
  moderate: (text: string) => Promise<"CLEAR" | "FLAG" | "HARD_BLOCK">;
  /** The channel's text-publication policy (like donation messages): auto_if_clean → clean text goes SHOWN immediately. */
  textShowMode?: "manual" | "auto_if_clean";
  /**
   * Trustless verification of the on-chain escrow (chain mode, ADR 0017): the account exists, its owner = the program,
   * donor/amount match. Closes the trust in the client (you can't record a task without a real escrow or with someone
   * else's amount). In mock/api there's no money → always true. In chain mode the server reads devnet.
   */
  verifyEscrow: (
    escrowTaskId: string,
    expect: { donor: string; amount: string; streamer?: string },
  ) => Promise<boolean>;
  /**
   * Verification of the on-chain commitment to the task text (CR-4): `escrowTaskId` (the escrow-PDA seed) must equal
   * `SHA-256(nonce ‖ text)`. Guarantees the mirror carries EXACTLY the text baked into the on-chain address — the client
   * can't fund one text and record another, and the operator can't later swap the text unnoticed. Pure crypto
   * (browser+server), doesn't read the chain. Called only for a chain task (has `escrowTaskId`); without `nonce` → false (fail-closed).
   */
  verifyTextCommitment: (escrowTaskId: string, text: string, nonce?: string) => Promise<boolean>;
  /**
   * Reconcile reputation against the CHAIN (ESC-12/M3, chain mode): the on-chain escrow outcome (money = truth).
   * `"to_streamer"|"to_donor"` — the outcome is confirmed (a live `resolution` or an indexed claim);
   * `null` — the outcome is unknown (Unresolved / not indexed / RPC failure / outside chain mode) → we defer the
   * banking. Absent (mock/api) → a task without `escrowTaskId`, no chain reconciliation needed.
   */
  escrowOutcome?: (escrowTaskId: string) => Promise<"to_streamer" | "to_donor" | null>;
  /**
   * Raw on-chain escrow state (ESC-19): 0 Pending, 1 Accepted, 2 Done, 3 Resolved, 4 Disputed; `null` —
   * not configured / account closed / RPC failure. Needed so off-chain can reveal the task text on an on-chain `accept`
   * (state≥Accepted) INDEPENDENTLY of the UI — the streamer can't take the money without accepting, and accept exposes the text.
   */
  escrowState?: (escrowTaskId: string) => Promise<number | null>;
  /**
   * Operator content takedown (platform moderation): whether this id (task/message) has been pulled from publication.
   * The source of truth is the provider's override set (the operator-actions log), NOT the game slice. Overrides
   * everything: the streamer won't show it, chain auto-reveal (ESC-19) won't bring it back. Absent (no operator
   * actions) → nothing is pulled. This doesn't touch on-chain money — only content visibility (§4.1/§4.2).
   */
  isContentBlocked?: (contentId: string) => boolean;
}

export type GameHandler = (ctx: GameContext, payload: unknown) => unknown | Promise<unknown>;

export interface GameHandlers {
  /** Mutations — via `gameAction`. */
  actions?: Record<string, GameHandler>;
  /** Reads — via `gameQuery`. */
  queries?: Record<string, GameHandler>;
}

export type GameHandlerRegistry = Record<string, GameHandlers>;

/**
 * Registry of handlers by game id. Populated on import from `games/index.ts` (currently — `escrow-task`).
 * Adding a game = registering its handlers there (like the manifest in `registry.ts`).
 */
export const GAME_HANDLERS: GameHandlerRegistry = {};

/** Bus domain error (mapped by the provider into DataError → reaches the client with a clear code). */
export class GameBusError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GameBusError";
  }
}

/**
 * Routes a game operation to its handler. Throws `GameBusError` on an unknown game or operation — the provider
 * catches it and turns it into DataError. `registry` is passed as a parameter (not taken from the module) —
 * that's what makes it testable (you can inject a fake game) without registration side effects.
 */
export async function dispatchGame(
  registry: GameHandlerRegistry,
  gameId: string,
  kind: "action" | "query",
  op: string,
  ctx: GameContext,
  payload: unknown,
): Promise<unknown> {
  const handlers = registry[gameId];
  if (!handlers) throw new GameBusError("UNKNOWN_GAME", `Mini-game not found: ${gameId}`);
  const table = kind === "action" ? handlers.actions : handlers.queries;
  const fn = table?.[op];
  if (!fn)
    throw new GameBusError("UNKNOWN_OP", `Operation "${op}" is not supported by game ${gameId}.`);
  return fn(ctx, payload);
}
