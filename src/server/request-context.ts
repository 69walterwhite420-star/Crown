import { AsyncLocalStorage } from "node:async_hooks";
import type { Address } from "@/lib/data/types";

/**
 * Per-request identity via AsyncLocalStorage (audit H3). Previously identity lived on a MUTABLE field
 * of the singleton store (`__setAddress`) — concurrent RPCs overwrote each other's, which is only safe
 * while the store methods are synchronous (the `latencyScale=0` hack). On migration to Postgres, the very first real
 * `await` between setting the address and checking permissions = cross-request escalation. AsyncLocalStorage carries
 * identity along the request's async context, surviving `await`/timers. Server-only module —
 * `node:async_hooks` never ends up in the store's browser bundle (mock mode).
 *
 * Instance on `globalThis` (like the store and the nonce/session stores) — to survive HMR as a single instance.
 */
interface RequestIdentity {
  address: Address | null;
}

const g = globalThis as unknown as { __standingReqCtx?: AsyncLocalStorage<RequestIdentity> };
const requestContext = (g.__standingReqCtx ??= new AsyncLocalStorage<RequestIdentity>());

/** Run `fn` in a context with the given request identity. The return of `fn` is passed through as-is. */
export function runWithIdentity<T>(address: Address | null, fn: () => T): T {
  return requestContext.run({ address }, fn);
}

/** Identity of the current request; `undefined` outside a context (browser mock / background server paths). */
export function currentIdentity(): Address | null | undefined {
  return requestContext.getStore()?.address;
}
