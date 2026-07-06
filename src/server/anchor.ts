import { readFileSync } from "fs";
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { DEVNET_RPC } from "@/lib/chain/config";
import { buildMemoInstruction } from "@/lib/chain/memo";
import { sha256Hex, stableStringify } from "@/lib/data/canonical";
import type { MockDataProvider } from "@/lib/data/mock-provider";
import { getMeta, setMeta } from "@/server/store-db";

/**
 * Proof anchor: a periodic memo transaction carrying digests of off-chain state (the Reign ledger, config
 * versions, the operator log: incident log + operator actions). The goal is transparency of the
 * centralized layer: operator T&S and configs stay manageable (this is a feature, yellow-paper §10),
 * but every state gets an indelible, timestamped on-chain fingerprint. Silently rewriting the past
 * (the ledger, a config version, "this takedown never happened") is impossible — a third party
 * recomputes the digests from /api/v1/export/anchor and compares them against the on-chain memo
 * (scripts/verify-export.ts).
 *
 * The anchor never touches money: the signer pays only its own gas (no key over anyone else's funds, §4.1).
 * The key is set via env `ANCHOR_SIGNER_KEYPAIR` (path to keypair.json or an inline JSON array); without a key
 * the anchor is disabled (the feature is additive — its absence does not break accepting money).
 */

export const ANCHOR_MEMO_TAG = "standing-anchor/1";
const META_KEY = "anchorLast";
// No more than once per interval (default 1 hour): we anchor STATE, not every event — gas is trivial, but
// there's no point spamming the chain. No changes → no new anchor at all.
const MIN_INTERVAL_MS = Number(process.env.ANCHOR_INTERVAL_MS ?? 60 * 60_000);

export interface AnchorDigests {
  ledger: string; // sha256(stableStringify(all ledger events))
  configs: string; // sha256(stableStringify(all config versions of all realms))
  // Operator log (incident log + operator actions /ops) — NOT the decisions of a streamer's realm
  // moderators (those live in message state). Content is private → sha256({incidents: [...], actions: [...]}).
  operatorLog: string;
}

export interface AnchorBundle {
  digests: AnchorDigests;
  ledgerCount: number;
  incidentHashes: string[];
  actionHashes: string[];
}

/** The last published anchor (meta) — for export and to guard against republishing. */
export interface AnchorRecord extends AnchorDigests {
  signature: string;
  ts: string;
  ledgerCount: number;
}

/**
 * Digests of the current state. The operator log contains private text (§4.6) — only per-record hashes go
 * into the digest and out to the world: integrity and completeness are verifiable, the content is not revealed.
 */
export async function computeAnchorBundle(store: MockDataProvider): Promise<AnchorBundle> {
  const { ledger, configs, incidents, operatorActions } = store.exportAnchorData();
  const incidentHashes = await Promise.all(incidents.map((i) => sha256Hex(stableStringify(i))));
  const actionHashes = await Promise.all(operatorActions.map((a) => sha256Hex(stableStringify(a))));
  return {
    digests: {
      ledger: await sha256Hex(stableStringify(ledger)),
      configs: await sha256Hex(stableStringify(configs)),
      operatorLog: await sha256Hex(
        stableStringify({ incidents: incidentHashes, actions: actionHashes }),
      ),
    },
    ledgerCount: ledger.length,
    incidentHashes,
    actionHashes,
  };
}

export async function anchorStatus(): Promise<AnchorRecord | null> {
  const raw = await getMeta(META_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AnchorRecord;
  } catch {
    return null;
  }
}

function loadAnchorKeypair(): Keypair | null {
  const v = process.env.ANCHOR_SIGNER_KEYPAIR;
  if (!v) return null;
  try {
    const raw = v.trim().startsWith("[") ? v : readFileSync(v, "utf8");
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw) as number[]));
  } catch (e) {
    console.error("[anchor] ANCHOR_SIGNER_KEYPAIR could not be read:", e instanceof Error ? e.message : e);
    return null;
  }
}

let warnedNoKey = false;

/**
 * Publish an anchor if the state changed and the interval elapsed. Idempotent to calls from the indexer
 * loop; an RPC failure is not critical — the next attempt happens on the next tick. Returns true on publish.
 */
export async function maybeAnchor(store: MockDataProvider): Promise<boolean> {
  const { digests, ledgerCount } = await computeAnchorBundle(store);
  const last = await anchorStatus();
  if (
    last &&
    last.ledger === digests.ledger &&
    last.configs === digests.configs &&
    last.operatorLog === digests.operatorLog
  )
    return false; // state unchanged — nothing to anchor
  if (last && Date.now() - Date.parse(last.ts) < MIN_INTERVAL_MS) return false; // wait out the interval

  const kp = loadAnchorKeypair();
  if (!kp) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      console.log("[anchor] ANCHOR_SIGNER_KEYPAIR not set — proof anchor disabled");
    }
    return false;
  }

  const ts = new Date().toISOString();
  const memo = JSON.stringify({
    std: ANCHOR_MEMO_TAG,
    t: ts,
    n: ledgerCount,
    j: digests.ledger,
    c: digests.configs,
    o: digests.operatorLog,
  });
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const tx = new Transaction().add(buildMemoInstruction(memo));
  tx.feePayer = kp.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const signature = await connection.sendTransaction(tx, [kp]);

  const record: AnchorRecord = { ...digests, signature, ts, ledgerCount };
  await setMeta(META_KEY, JSON.stringify(record));
  console.log(`[anchor] anchor published: ${signature}`);
  return true;
}
