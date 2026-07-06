import fs from "fs";
import path from "path";
import { decode, encode } from "@/lib/data/codec";

/**
 * Lightweight local persistence (ADR 0013). A stand-in for Postgres (schema — yellow-paper §13): instead of a DB —
 * atomic JSON snapshots on disk in `.data/` (gitignored). Stores/sessions stay fast in-memory, but
 * SURVIVE a process restart (previously everything was wiped on every dev-server restart).
 *
 * Server-only module (uses node:fs) — never ends up in the client bundle. bigint-safe (codec).
 * The trade-off is honest: the whole file lives in memory (fine at dev scale), writes are throttled (≤1/250ms),
 * so on a hard kill you may lose the last <250ms of changes. For production scale → a real DB.
 */
const DIR = path.join(process.cwd(), ".data");

/** Synchronous snapshot read at startup (once, small file). null — no file or it's corrupt. */
export function readSnapshot<T>(name: string): T | null {
  try {
    return decode<T>(fs.readFileSync(path.join(DIR, name), "utf8"));
  } catch {
    return null; // no file / corrupt → start from a clean state
  }
}

/** Atomic write: tmp + rename — leaves no half-written file if it fails mid-write. */
function writeAtomic(name: string, data: string): void {
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, name);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, "utf8");
  fs.renameSync(tmp, file);
}

/**
 * Throttled saver: when called, schedules an atomic write of a fresh getData() at most once per 250ms, coalescing
 * bursts of mutations; the last change always lands (the flag is cleared BEFORE the write). A write error is not
 * propagated into the request — we log it (disk must not bring down RPC).
 */
export function makeSaver(name: string, getData: () => unknown): () => void {
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      try {
        writeAtomic(name, encode(getData()));
      } catch (e) {
        console.error(`[persist] failed to save ${name}:`, e);
      }
    }, 250);
  };
}
