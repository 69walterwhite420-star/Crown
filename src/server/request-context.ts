import { AsyncLocalStorage } from "node:async_hooks";
import type { Address } from "@/lib/data/types";

/**
 * Per-request личность через AsyncLocalStorage (аудит H3). Раньше личность жила на МУТИРУЕМОМ поле
 * singleton-стора (`__setAddress`) — конкурентные RPC перетирали её друг у друга, и это безопасно лишь
 * пока методы стора синхронны (костыль `latencyScale=0`). При миграции на Postgres первый же реальный
 * `await` между установкой адреса и проверкой прав = межзапросная эскалация. AsyncLocalStorage несёт
 * личность по async-контексту запроса, переживая `await`/таймеры. Только серверный модуль —
 * `node:async_hooks` не попадает в браузерный bundle стора (mock-режим).
 *
 * Инстанс на `globalThis` (как стор и nonce/session-сторы) — чтобы переживать HMR одним экземпляром.
 */
interface RequestIdentity {
  address: Address | null;
}

const g = globalThis as unknown as { __standingReqCtx?: AsyncLocalStorage<RequestIdentity> };
const requestContext = (g.__standingReqCtx ??= new AsyncLocalStorage<RequestIdentity>());

/** Выполнить `fn` в контексте с заданной личностью запроса. Возврат `fn` пробрасывается как есть. */
export function runWithIdentity<T>(address: Address | null, fn: () => T): T {
  return requestContext.run({ address }, fn);
}

/** Личность текущего запроса; `undefined` вне контекста (браузерный mock / фоновые серверные пути). */
export function currentIdentity(): Address | null | undefined {
  return requestContext.getStore()?.address;
}
