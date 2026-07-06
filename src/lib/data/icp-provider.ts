/**
 * IcpDataProvider — the `icp` mode (M1+M2 of the migration, ADR 0021): the ICP canister = the CANON of Reign and disputes.
 *
 * A hybrid on top of ChainDataProvider. To the canister go:
 *  - Reign reads: `getStanding`, `getLeaderboard`, the numbers and journal of `getDonorOverview`
 *    (HTTP export of the core canister; the browser reads the canon BYPASSING our server — that's the point of the phase);
 *  - disputes over chain tasks (M2): opening/voting — wallet signatures to the arbiter (`gameAction`),
 *    the dispute state is MERGED into task reads (`gameQuery`/`homeFeed`) — the server mirror
 *    doesn't see the dispute, the canon of status/votes/verdict is the arbiter;
 *  - a realm's dispute governance parameters (M1): read/write with the owner's signature.
 * Everything else — as in chain: wallet, Crowns, escrow money, texts/moderation/profiles — the server.
 *
 * The cosmetics stay skin: donor names on the leaderboard are pulled from the server and joined
 * to the canonical numbers; server unavailable → numbers without names (money/Reign don't depend on skin).
 *
 * The canon delta at the transition (yellow-paper §18.5-8a): the canister knows only on-chain events;
 * realms of the mock era (without on-chain activation) keep server numbers and events.
 *
 * Rollback (migration-plan §3): NEXT_PUBLIC_DATA_SOURCE=chain — the frontend reads the server again.
 */
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { ESCROW_PROGRAM_ID, ICP_CANISTER_URL } from "@/lib/chain/addresses";
import {
  buildDisputeParamsMessage,
  normalizeDisputeParams,
  type DisputeParamsInfo,
  type DisputeParamsValues,
  type RawDisputeParamsResponse,
} from "@/lib/chain/dispute-params";
import {
  buildOpenDisputeMessage,
  buildVoteMessage,
  normalizeCanisterDispute,
  type CanisterDisputeView,
} from "@/lib/chain/dispute-vote";
import { escrowPda } from "@/lib/chain/escrow-tx";
import { resolveTier } from "@/lib/reputation";
import { disputeVotesView } from "@/games/escrow-task/machine";
import type { DisputeVotesResult, EscrowTask, TaskDispute } from "@/games/escrow-task/types";
import { ChainDataProvider } from "./chain-provider";
import { DataError, type Result } from "./provider";
import type {
  Address,
  DonorOverview,
  DonorPointEvent,
  GameRequest,
  HomeFeed,
  LeaderboardEntry,
  LeaderboardPeriod,
  ViewerStanding,
} from "./types";

/** Donor aggregate from the canister's HTTP export (`/standing`, `/leaderboard`). Money as strings. */
interface CanisterAgg {
  address: string;
  pointsMicro: string;
  totalDonatedMicro: string;
  donations: number;
  firstBlockTime: number | null;
}

const MICRO_PER_POINT = 1_000_000;
/** The leaderboard's "month" = a rolling 30 days — the same semantics as the server (mock-provider). */
const MONTH_MS = 30 * 86_400_000;

/** A donor journal entry from the canister's `/donor` (detail for the profile's "Reign journal"). */
interface CanisterDonorEvent {
  seq: number;
  channelId: string;
  kind: "DONATION" | "GAME_DONATION" | "DISPUTE_WON" | "DISPUTE_LOST";
  pointsDeltaMicro: string; // signed (DISPUTE_LOST < 0)
  amountMicro: string;
  blockTime: number | null;
  signature: string; // tx signature for money entries; pseudo `dispute:…` for dispute effects
}

/** Canister dispute → the off-chain TaskDispute form (micro → points at the UI boundary). null — no dispute. */
function canisterDisputeAsTask(cd: CanisterDisputeView): TaskDispute | null {
  if (cd.openedAtMs == null) return null;
  return {
    by: cd.openedBy ?? "",
    openedAt: new Date(cd.openedAtMs).toISOString(),
    votingEndsAt: new Date(cd.votingEndsAtMs ?? cd.openedAtMs).toISOString(),
    quorum: Number(cd.quorumMicro) / MICRO_PER_POINT,
    votes: cd.votes.map((v) => ({
      voter: v.voter,
      choice: v.choice,
      weight: Number(v.weightMicro) / MICRO_PER_POINT,
      at: new Date(v.atMs).toISOString(),
    })),
  };
}

/**
 * Merge the canister dispute into the server-mirror task: dispute status/votes are the arbiter's canon.
 * We don't downgrade the server's RESOLVED (the indexer already saw the on-chain outcome — with it the dispute is history);
 * otherwise a task with an ongoing/decided dispute would show as DISPUTED rather than the mirror's "DONE".
 */
function mergeCanisterDispute(
  task: EscrowTask,
  cases: Map<string, CanisterDisputeView>,
): EscrowTask {
  const cd = task.escrowTaskId ? cases.get(task.escrowTaskId) : undefined;
  const dispute = cd ? canisterDisputeAsTask(cd) : null;
  if (!dispute) return task;
  return task.status === "RESOLVED" ? { ...task, dispute } : { ...task, status: "DISPUTED", dispute };
}

export class IcpDataProvider extends ChainDataProvider {
  private async canisterGet<T>(path: string): Promise<T> {
    if (!ICP_CANISTER_URL) {
      throw new DataError(
        "NOT_CONFIGURED",
        "The icp mode requires NEXT_PUBLIC_ICP_CANISTER_URL (runbook 'ICP canisters').",
      );
    }
    let res: Response;
    try {
      res = await fetch(`${ICP_CANISTER_URL}${path}`);
    } catch {
      throw new DataError(
        "NETWORK",
        "The canister is unavailable — is the local stand up? (runbook 'ICP canisters')",
      );
    }
    if (!res.ok) throw new DataError("BAD_RESPONSE", `The canister responded HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  override getStanding(channelId: string, donor: Address): Result<ViewerStanding | null> {
    return (async () => {
      const [{ standing }, config] = await Promise.all([
        this.canisterGet<{ standing: CanisterAgg }>(
          `/standing?channel=${encodeURIComponent(channelId)}&address=${encodeURIComponent(donor)}`,
        ),
        this.getChannelConfig(channelId), // tiers — the realm config (skin), the points scale itself — canon
      ]);
      if (standing.donations === 0) return null; // like the server: no history → no standing
      const points = Number(standing.pointsMicro) / MICRO_PER_POINT;
      const { tier, nextTier, progressToNext } = resolveTier(points, config.tiers);
      return {
        channelId,
        donor,
        points,
        tier,
        nextTier,
        progressToNext,
        totalDonated: BigInt(standing.totalDonatedMicro),
        firstDonationAt:
          standing.firstBlockTime != null
            ? new Date(standing.firstBlockTime * 1000).toISOString()
            : undefined,
      };
    })();
  }

  override getLeaderboard(
    channelId: string,
    period: LeaderboardPeriod,
  ): Result<LeaderboardEntry[]> {
    return (async () => {
      const since = period === "month" ? Math.floor((Date.now() - MONTH_MS) / 1000) : undefined;
      const [board, config, skin] = await Promise.all([
        this.canisterGet<{ rows: CanisterAgg[] }>(
          `/leaderboard?channel=${encodeURIComponent(channelId)}&limit=100` +
            (since !== undefined ? `&since=${since}` : ""),
        ),
        this.getChannelConfig(channelId),
        // Names — cosmetics from the server; its unavailability does NOT break the canon (we'll show numbers without names).
        super.getLeaderboard(channelId, period).catch(() => [] as LeaderboardEntry[]),
      ]);
      const displayNames = new Map(skin.map((e) => [e.donor, e.displayName]));
      return board.rows.map((r, i) => {
        const points = Number(r.pointsMicro) / MICRO_PER_POINT;
        return {
          rank: i + 1,
          donor: r.address,
          displayName: displayNames.get(r.address),
          points,
          tier: resolveTier(points, config.tiers).tier,
          totalDonated: BigInt(r.totalDonatedMicro),
        };
      });
    })();
  }

  /**
   * Donor profile (/me, /u): Reign/money numbers per realm — the CANON from the canister
   * (`/donor?address=`), the skin (realm names, handle, activity texts) — from the server.
   * Realms the canister doesn't know (mock era, no on-chain activation) keep
   * server numbers — an honest transitional delta (yellow-paper §18.5-8a).
   */
  override getDonorOverview(address: Address): Result<DonorOverview> {
    return (async () => {
      const [base, canon] = await Promise.all([
        super.getDonorOverview(address),
        this.canisterGet<{
          rows: (CanisterAgg & { channelId: string; lastBlockTime: number | null })[];
          events?: CanisterDonorEvent[];
        }>(`/donor?address=${encodeURIComponent(address)}`),
      ]);
      const byChannel = new Map(canon.rows.map((r) => [r.channelId, r]));

      const iso = (bt: number | null | undefined) =>
        bt != null ? new Date(bt * 1000).toISOString() : undefined;
      const standings = await Promise.all(
        base.standings.map(async (row) => {
          const c = byChannel.get(row.channelId);
          if (!c) return row; // the canister doesn't know the realm — the server row as is
          const points = Number(c.pointsMicro) / MICRO_PER_POINT;
          // Tier — by the realm's current ladder; config unavailable → no tier (honestly).
          const tier = await this.getChannelConfig(row.channelId)
            .then((cfg) => resolveTier(points, cfg.tiers).tier)
            .catch(() => undefined);
          return {
            ...row,
            points,
            tier,
            totalDonated: BigInt(c.totalDonatedMicro),
            donationCount: c.donations,
            firstDonationAt: iso(c.firstBlockTime) ?? row.firstDonationAt,
            lastDonationAt: iso(c.lastBlockTime) ?? row.lastDonationAt,
          };
        }),
      );
      standings.sort((a, b) => (a.totalDonated < b.totalDonated ? 1 : -1));

      const topStanding = standings.reduce(
        (best, row) => (best === undefined || row.points > best.points ? row : best),
        undefined as (typeof standings)[number] | undefined,
      );
      const firstDonationAt = standings
        .map((r) => r.firstDonationAt)
        .filter((v): v is string => !!v)
        .sort()[0];

      // "Reign journal": for realms the canister knows — detail from ITS journal
      // (including dispute effects DISPUTE_WON/LOST and task payouts GAME_DONATION) — otherwise the number
      // above (canon) wouldn't match the list of events below it. The skin (Crown text) is joined
      // from the server event by tx signature; realms of the mock era keep server events.
      const skinBySig = new Map(
        base.pointEvents.filter((e) => e.txSignature).map((e) => [e.txSignature!, e]),
      );
      // The escrow task text — skin, the canister doesn't have it (and won't: the canister is only about money/Reign).
      // We join the text from the server by the (realm, amount) pair — the canister entry and the server event describe
      // ONE escrow Crown; a list per key + shift() disambiguates the rare case of two tasks of the same amount on a realm.
      const escrowSkinByKey = new Map<string, DonorPointEvent[]>();
      for (const e of base.pointEvents) {
        if (e.type !== "GAME_DONATION") continue;
        const k = `${e.channelId}:${e.amount}`;
        const list = escrowSkinByKey.get(k);
        if (list) list.push(e);
        else escrowSkinByKey.set(k, [e]);
      }
      // Pairing with the canon (canon.events — by seq, old→new) is chronological: we sort each
      // list by ascending ts, so that on a collision (two tasks of the same amount on a realm) `shift()` returns
      // the events in the same order. Funded earlier ⇒ claimed ⇒ resolved earlier — the orders line up.
      for (const list of escrowSkinByKey.values()) list.sort((a, b) => (a.ts < b.ts ? -1 : 1));
      const canonEvents: DonorPointEvent[] = (canon.events ?? []).map((e) => {
        const skin = skinBySig.get(e.signature);
        const escrowSkin =
          e.kind === "GAME_DONATION"
            ? escrowSkinByKey.get(`${e.channelId}:${e.amountMicro}`)?.shift()
            : undefined;
        const isTx = !e.signature.startsWith("dispute:"); // a dispute-effect pseudo-signature — not a link
        return {
          id: `icp:${e.seq}`,
          channelId: e.channelId,
          type: e.kind,
          pointsDelta: Number(e.pointsDeltaMicro) / MICRO_PER_POINT,
          amount: BigInt(e.amountMicro),
          ts:
            e.blockTime != null
              ? new Date(e.blockTime * 1000).toISOString()
              : (skin?.ts ?? escrowSkin?.ts ?? new Date(0).toISOString()),
          txSignature: isTx ? e.signature : undefined,
          escrowTaskId: escrowSkin?.escrowTaskId,
          message: skin?.message ?? escrowSkin?.message, // Crown — by signature; task — by (realm, amount)
        };
      });
      // A canister without `events` (code before the M2 detail, not yet redeployed) → the server journal
      // as it was: worse than canon, but not emptiness.
      const pointEvents = canon.events
        ? [...canonEvents, ...base.pointEvents.filter((e) => !byChannel.has(e.channelId))].sort(
            (a, b) => (a.ts < b.ts ? 1 : -1),
          )
        : base.pointEvents;

      return {
        ...base,
        standings,
        topStanding,
        totalDonated: standings.reduce((sum, r) => sum + r.totalDonated, 0n),
        donationCount: standings.reduce((sum, r) => sum + r.donationCount, 0),
        channelsSupported: standings.filter((r) => r.donationCount > 0).length,
        firstDonationAt: firstDonationAt ?? base.firstDonationAt,
        pointEvents,
      };
    })();
  }

  // ─────────── dispute governance parameters (M1): canon is the canister ───────────

  getDisputeParams(channelId: string): Result<DisputeParamsInfo> {
    return (async () => {
      const raw = await this.canisterGet<RawDisputeParamsResponse>(
        `/dispute-params?channel=${encodeURIComponent(channelId)}`,
      );
      return normalizeDisputeParams(raw);
    })();
  }

  /**
   * Writing parameters: canon message → signed by the wallet (ed25519, gasless) → POST to the canister.
   * The right to write is checked by the CANISTER (owner = the activation payer from the chain, version nonce,
   * timelock §8.9) — here only early, clear refusals before going for a signature.
   */
  setDisputeParams(channelId: string, params: DisputeParamsValues): Result<DisputeParamsInfo> {
    return (async () => {
      const w = this.wallet;
      if (!w?.publicKey || !w.signMessage)
        throw new DataError("NO_SIGN", "This wallet can't sign messages.");
      const me = w.publicKey.toBase58();

      const info = await this.getDisputeParams(channelId);
      if (!info.owner)
        throw new DataError(
          "NOT_OWNER",
          "The realm isn't activated on-chain — the canister doesn't know the owner (rules can't be changed).",
        );
      if (info.owner !== me)
        throw new DataError(
          "NOT_OWNER",
          `Only the realm owner (activation payer ${info.owner.slice(0, 8)}…) can change the rules — a different wallet is connected.`,
        );

      const version = info.version + 1;
      const message = buildDisputeParamsMessage(channelId, me, version, params);
      const signature = bs58.encode(await w.signMessage(new TextEncoder().encode(message)));

      let res: Response;
      try {
        res = await fetch(`${ICP_CANISTER_URL}/dispute-params`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channelId,
            owner: me,
            version,
            params: {
              minReputationToDisputeMicro: params.minReputationToDisputeMicro.toString(),
              minWeightToVoteMicro: params.minWeightToVoteMicro.toString(),
              quorumMicro: params.quorumMicro.toString(),
              disputeWindowSecs: params.disputeWindowSecs,
              votingWindowSecs: params.votingWindowSecs,
              dMaxMicro: params.dMaxMicro.toString(),
              disputeWinBonusMicro: params.disputeWinBonusMicro.toString(),
              disputeLossPenaltyMicro: params.disputeLossPenaltyMicro.toString(),
            },
            signature,
          }),
        });
      } catch {
        throw new DataError(
          "NETWORK",
          "The canister is unavailable — is the local stand up? (runbook 'ICP canisters')",
        );
      }
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !body.ok)
        throw new DataError(
          "BAD_RESPONSE",
          `The canister rejected the write: ${body.error ?? `HTTP ${res.status}`}`,
        );
      return this.getDisputeParams(channelId);
    })();
  }

  // ─────────── disputes over chain tasks (M2): canon is the canister arbiter ───────────

  /** Cache of `/disputes?channel=` (map key — hex escrowTaskId): one trip per batch of task reads. */
  private disputesCache = new Map<string, { at: number; map: Map<string, CanisterDisputeView> }>();
  private static readonly DISPUTES_TTL_MS = 10_000;

  /**
   * All of a realm's disputes from the canister. Canister unavailability degrades to an empty map (also
   * cached for the TTL — we don't hammer a downed gateway): tasks show from the server mirror, the dispute
   * canon is pulled by later requests. The targeted `getCanisterDispute` does NOT hide the error.
   */
  private async channelDisputes(channelId: string): Promise<Map<string, CanisterDisputeView>> {
    const hit = this.disputesCache.get(channelId);
    if (hit && Date.now() - hit.at < IcpDataProvider.DISPUTES_TTL_MS) return hit.map;
    const map = new Map<string, CanisterDisputeView>();
    try {
      const res = await this.canisterGet<{
        disputes: Parameters<typeof normalizeCanisterDispute>[0][];
      }>(`/disputes?channel=${encodeURIComponent(channelId)}`);
      for (const raw of res.disputes) {
        const cd = normalizeCanisterDispute(raw);
        if (cd.escrowTaskId) map.set(cd.escrowTaskId, cd);
      }
    } catch {
      /* empty map below */
    }
    this.disputesCache.set(channelId, { at: Date.now(), map });
    return map;
  }

  /**
   * Task reads: the server mirror (money/texts/moderation) + the DISPUTE from the canister (arbiter canon).
   * Opening/voting go to the canister bypassing the server (gameAction below), so without merging the feed,
   * the studio, the dispute page, and the dashboard would show the task as "DONE" without a dispute — and the card
   * would even offer "Claim" during live voting.
   */
  override gameQuery(req: GameRequest): Result<unknown> {
    return (async () => {
      if (req.gameId !== "escrow-task") return super.gameQuery(req);
      if (req.op === "list") {
        const [base, cases] = await Promise.all([
          super.gameQuery(req) as Promise<{ tasks: EscrowTask[] } | null>,
          this.channelDisputes(req.channelId),
        ]);
        if (!base?.tasks?.length || !cases.size) return base;
        return { ...base, tasks: base.tasks.map((t) => mergeCanisterDispute(t, cases)) };
      }
      if (req.op === "get") {
        const [task, cases] = await Promise.all([
          super.gameQuery(req) as Promise<EscrowTask | null>,
          this.channelDisputes(req.channelId),
        ]);
        return task ? mergeCanisterDispute(task, cases) : task;
      }
      if (req.op === "disputeVotes") {
        // The server knows only off-chain disputes (tasks of the mock/api era); we assemble the canister dispute
        // into the same paginated view with the same pure function (machine.disputeVotesView).
        const base = (await super.gameQuery(req)) as DisputeVotesResult | null;
        if (base?.found) return base;
        const taskId = (req.payload as { taskId?: string } | null)?.taskId;
        if (!taskId) return base;
        const task = (await super.gameQuery({
          gameId: req.gameId,
          channelId: req.channelId,
          op: "get",
          payload: { taskId },
        })) as EscrowTask | null;
        if (!task?.escrowTaskId) return base;
        const merged = mergeCanisterDispute(task, await this.channelDisputes(req.channelId));
        return merged.dispute ? disputeVotesView(merged, req.payload) : base;
      }
      return super.gameQuery(req);
    })();
  }

  /**
   * The "Needs you" dashboard: the server computes the cycles, but it doesn't see the canister dispute — a donor's task
   * with ongoing voting would forever stay "Dispute or wait". We ripen the cycles:
   * a dispute window with a dispute open in the canister → "Voting in progress" with its deadline.
   */
  override homeFeed(): Result<HomeFeed> {
    return (async () => {
      const base = await super.homeFeed();
      const cycles = await Promise.all(
        base.cycles.map(async (c) => {
          if (c.kind !== "dispute_window") return c;
          try {
            const cases = await this.channelDisputes(c.channelId);
            if (!cases.size) return c;
            const task = (await super.gameQuery({
              gameId: "escrow-task",
              channelId: c.channelId,
              op: "get",
              payload: { taskId: c.taskId },
            })) as EscrowTask | null;
            const cd = task?.escrowTaskId ? cases.get(task.escrowTaskId) : undefined;
            if (!cd || cd.openedAtMs == null) return c;
            return {
              ...c,
              kind: "voting" as const,
              deadline: cd.votingEndsAtMs
                ? new Date(cd.votingEndsAtMs).toISOString()
                : undefined,
              actionable: false,
            };
          } catch {
            return c; // canister unavailable → the server cycle as is
          }
        }),
      );
      return { ...base, cycles };
    })();
  }

  /** The task's escrow account address (base58 PDA); null = a task without on-chain escrow (mock era).
   * Deliberately `super.gameQuery`: dispute merging isn't needed here (only escrowTaskId is needed). */
  private async escrowAccountOf(channelId: string, taskId: string): Promise<string | null> {
    const task = (await super.gameQuery({
      gameId: "escrow-task",
      channelId,
      op: "get",
      payload: { taskId },
    })) as { escrowTaskId?: string } | null;
    if (!task?.escrowTaskId) return null;
    const seed = new Uint8Array(task.escrowTaskId.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
    return escrowPda(new PublicKey(ESCROW_PROGRAM_ID!), seed).toBase58();
  }

  getCanisterDispute(channelId: string, taskId: string): Result<CanisterDisputeView | null> {
    return (async () => {
      const escrowAccount = await this.escrowAccountOf(channelId, taskId);
      if (!escrowAccount) return null;
      let res: Response;
      try {
        res = await fetch(
          `${ICP_CANISTER_URL}/dispute?escrow=${encodeURIComponent(escrowAccount)}`,
        );
      } catch {
        throw new DataError("NETWORK", "The canister is unavailable (runbook 'ICP canisters')");
      }
      if (res.status === 404) return null; // no dispute for this escrow
      if (!res.ok) throw new DataError("BAD_RESPONSE", `The canister responded HTTP ${res.status}`);
      return normalizeCanisterDispute(
        (await res.json()) as Parameters<typeof normalizeCanisterDispute>[0],
      );
    })();
  }

  /**
   * Routing of dispute operations: for CHAIN tasks `raiseDispute`/`vote` go TO THE CANISTER
   * (wallet signature of the canonical message; the outcome is executed by the threshold resolver) — the same
   * panel buttons, a different substrate. Tasks without escrow (mock/api era) — as before, off-chain.
   */
  override gameAction(req: GameRequest): Result<unknown> {
    return (async () => {
      const p = (req.payload ?? {}) as { taskId?: string; choice?: string };
      if (
        req.gameId !== "escrow-task" ||
        !p.taskId ||
        (req.op !== "raiseDispute" && req.op !== "vote")
      )
        return super.gameAction(req);
      const escrowAccount = await this.escrowAccountOf(req.channelId, p.taskId);
      if (!escrowAccount) return super.gameAction(req);

      const w = this.wallet;
      if (!w?.publicKey || !w.signMessage)
        throw new DataError("NO_SIGN", "This wallet can't sign messages.");
      const me = w.publicKey.toBase58();

      const post = async (path: string, body: Record<string, unknown>) => {
        const res = await fetch(`${ICP_CANISTER_URL}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const out = (await res.json()) as { ok: boolean; error?: string };
        if (!res.ok || !out.ok)
          throw new DataError("BAD_RESPONSE", `Canister: ${out.error ?? `HTTP ${res.status}`}`);
      };

      if (req.op === "raiseDispute") {
        const message = buildOpenDisputeMessage(escrowAccount, req.channelId, me);
        const signature = bs58.encode(await w.signMessage(new TextEncoder().encode(message)));
        await post("/dispute/open", {
          escrowAccount,
          channelId: req.channelId,
          by: me,
          signature,
        });
        return { ok: true };
      }
      const choice = p.choice === "completed" ? "completed" : "not_completed";
      const message = buildVoteMessage(escrowAccount, req.channelId, me, choice);
      const signature = bs58.encode(await w.signMessage(new TextEncoder().encode(message)));
      await post("/dispute/vote", { escrowAccount, voter: me, choice, signature });
      return { ok: true };
    })();
  }
}
