import { describe, expect, it } from "vitest";
import { dispatchGame, GameBusError, type GameContext, type GameHandlerRegistry } from "./bus";

/**
 * Tests of the game-bus (ADR 0016): routing operations to the right game's handler, clear errors for an unknown
 * game/operation, and that the handler receives the context (identity/channel/payload) and reads/writes its own state
 * slice. The registry is passed as a parameter → we inject a fake game, without registration side effects.
 */

// — a simple in-memory state slice for the context —
function makeCtx(overrides: Partial<GameContext> = {}): GameContext {
  let slice: unknown;
  return {
    identity: "Donor111",
    channelId: "chan-1",
    channelOwner: "Streamer1",
    channelPayout: null,
    channelPayoutAttested: false,
    isChannelManager: false,
    minTaskAmountMicro: "0",
    minReputationToTask: 0,
    minReputationToDispute: 1,
    textMaxLen: 500,
    now: () => "2026-01-01T00:00:00.000Z",
    newId: () => "id-1",
    state: {
      get: <T = unknown>() => slice as T | undefined,
      set: (v: unknown) => {
        slice = v;
      },
    },
    reputationAsOf: () => 0,
    bankLedger: () => {},
    moderate: async () => "CLEAR",
    verifyEscrow: async () => true,
    verifyTextCommitment: async () => true,
    ...overrides,
  };
}

const registry: GameHandlerRegistry = {
  "test-game": {
    actions: {
      // puts the payload into state, returns who and when
      save: (ctx, payload) => {
        const prev = ctx.state.get<number>() ?? 0;
        ctx.state.set(prev + (payload as { add: number }).add);
        return { by: ctx.identity, at: ctx.now(), total: ctx.state.get<number>() };
      },
    },
    queries: {
      read: (ctx) => ({ total: ctx.state.get<number>() ?? 0, channelId: ctx.channelId }),
    },
  },
};

describe("dispatchGame — game-bus routing", () => {
  it("an action goes to the right handler, sees payload/identity and writes state", async () => {
    const ctx = makeCtx();
    const r = (await dispatchGame(registry, "test-game", "action", "save", ctx, { add: 5 })) as {
      by: string;
      at: string;
      total: number;
    };
    expect(r.by).toBe("Donor111");
    expect(r.at).toBe("2026-01-01T00:00:00.000Z");
    expect(r.total).toBe(5);
  });

  it("a query reads the state written by an action (one slice per game)", async () => {
    const ctx = makeCtx();
    await dispatchGame(registry, "test-game", "action", "save", ctx, { add: 3 });
    await dispatchGame(registry, "test-game", "action", "save", ctx, { add: 4 });
    const r = (await dispatchGame(registry, "test-game", "query", "read", ctx, undefined)) as {
      total: number;
      channelId: string;
    };
    expect(r.total).toBe(7);
    expect(r.channelId).toBe("chan-1");
  });

  it("unknown game → GameBusError(UNKNOWN_GAME)", async () => {
    await expect(
      dispatchGame(registry, "no-such-game", "action", "save", makeCtx(), {}),
    ).rejects.toMatchObject({ code: "UNKNOWN_GAME" });
  });

  it("unknown operation → GameBusError(UNKNOWN_OP)", async () => {
    await expect(
      dispatchGame(registry, "test-game", "action", "nope", makeCtx(), {}),
    ).rejects.toMatchObject({ code: "UNKNOWN_OP" });
  });

  it("actions and queries — different tables: an action op isn't visible as a query", async () => {
    const err = await dispatchGame(registry, "test-game", "query", "save", makeCtx(), {}).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(GameBusError);
    expect((err as GameBusError).code).toBe("UNKNOWN_OP");
  });
});
