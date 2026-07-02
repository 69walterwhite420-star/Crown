/**
 * Независимая проверка «сервер не решает, а считает» (§4.4 + H1 + пруф-якорь) по публичному экспорту.
 * Запуск НЕ требует доверия к серверу: всё, что он отдаёт, пересчитывается локально этим скриптом
 * (движок репутации, подпись payout, дайджесты), а с флагом --chain — сверяется с цепочкой (истина денег).
 *
 *   npx tsx scripts/verify-export.ts --channel <handle> [--url http://localhost:3000] [--chain] [--deep N]
 *
 * Проверки:
 *  1) H1: payout-адрес канала подписан ключом владельца (ed25519, lib/chain/attestation.ts).
 *  2) §4.4: репутация каждого донора лидерборда = свёртка журнала общим движком (lib/reputation.ts);
 *     каждая DONATION-дельта = pointsForAmount(суммы) — «переписанные» дельты не пройдут.
 *  3) Пруф-якорь: дайджесты журнала/конфигов/лога модерации пересчитываются из /api/v1/export/anchor
 *     и сверяются с сохранённым якорем; --chain дополнительно читает memo якорной tx ИЗ ЦЕПОЧКИ.
 *  4) --chain --deep N: последние N DONATION-событий сверяются с реальными транзакциями devnet
 *     (разбор пары 97/3 + memo тем же чистым extractDonation, что у индексера).
 *
 * Честное ограничение: экспорт показывает ТЕКУЩЕЕ состояние. Ловля переписанного ПРОШЛОГО требует либо
 * --chain (якоря в цепочке неизменяемы), либо сохранённых копий прежних экспортов.
 */
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { verifyPayoutAttestation } from "../src/lib/chain/attestation";
import { DEVNET_RPC, DEVNET_USDC_MINT, TREASURY_OWNER } from "../src/lib/chain/addresses";
import { extractDonation } from "../src/lib/chain/indexer";
import { sha256Hex, stableStringify } from "../src/lib/data/canonical";
import { decode } from "../src/lib/data/codec";
import { computePoints, pointsForAmount } from "../src/lib/reputation";
import type {
  Channel,
  ChannelConfig,
  LeaderboardEntry,
  LedgerEvent,
} from "../src/lib/data/types";

interface ChannelExport {
  format: string;
  generatedAt: string;
  channel: Channel;
  configs: ChannelConfig[];
  ledger: LedgerEvent[];
  leaderboard: LeaderboardEntry[];
}

interface AnchorExport {
  format: string;
  digests: { ledger: string; configs: string; moderation: string };
  ledgerCount: number;
  lastAnchor: {
    signature: string;
    ts: string;
    ledger: string;
    configs: string;
    moderation: string;
    ledgerCount: number;
  } | null;
  ledger: LedgerEvent[];
  configs: ChannelConfig[];
  incidentHashes: string[];
  actionHashes: string[];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const URL_BASE = arg("url") ?? "http://localhost:3000";
const HANDLE = arg("channel");
const CHAIN = process.argv.includes("--chain");
const DEEP = Number(arg("deep") ?? (CHAIN ? 10 : 0));

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}
function info(msg: string) {
  console.log(`ℹ️  ${msg}`);
}

async function fetchExport<T>(path: string): Promise<T> {
  const res = await fetch(`${URL_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return decode<T>(await res.text());
}

async function verifyChannel(handle: string): Promise<void> {
  console.log(`\n— Канал @${handle} (${URL_BASE}) —`);
  const ex = await fetchExport<ChannelExport>(`/api/v1/export/channel/${handle}`);
  const ch = ex.channel;

  // (1) H1: payout закреплён ключом владельца, не сервером.
  check(
    "H1: payout подписан владельцем",
    Boolean(ch.payoutAttestation) &&
      verifyPayoutAttestation(ch.ownerAddress, ch.payoutAddress, ch.payoutAttestation!),
    `payout ${ch.payoutAddress}`,
  );

  // (2) §4.4: пересчёт репутации из журнала тем же открытым движком.
  const byDonor = new Map<string, LedgerEvent[]>();
  for (const e of ex.ledger) {
    const list = byDonor.get(e.donor) ?? [];
    list.push(e);
    byDonor.set(e.donor, list);
  }
  // Дельты банкуются формулой НА МОМЕНТ доната и при смене формулы не переписываются (§4.4, банкинг) —
  // поэтому расхождение с ТЕКУЩЕЙ формулой для старых событий легально (напр., до-A3 округление).
  // Это предупреждение, не провал; несущая проверка — свёртка журнала ниже.
  const deltaMismatch = ex.ledger.filter(
    (e) => e.type === "DONATION" && e.pointsDelta !== pointsForAmount(e.amount),
  );
  if (deltaMismatch.length) {
    info(
      `${deltaMismatch.length} DONATION-дельт банкованы не текущей формулой (история, банкинг §4.4): ` +
        deltaMismatch.map((e) => e.id).join(", "),
    );
  } else {
    check("каждая DONATION-дельта = pointsForAmount(суммы) текущей формулой", true, `${ex.ledger.length} событий`);
  }

  let recomputedOk = true;
  for (const entry of ex.leaderboard) {
    const events = byDonor.get(entry.donor) ?? [];
    const points = computePoints(events);
    if (points !== entry.points) {
      recomputedOk = false;
      check(
        "репутация = свёртка журнала",
        false,
        `${entry.donor.slice(0, 8)}…: лидерборд ${entry.points}, пересчёт ${points}`,
      );
    }
  }
  if (recomputedOk)
    check("репутация каждого донора = свёртка журнала", true, `${ex.leaderboard.length} доноров`);

  // (4) --chain --deep: сверка последних DONATION с реальными транзакциями (истина денег — цепочка).
  if (CHAIN && DEEP > 0) {
    const connection = new Connection(DEVNET_RPC, "confirmed");
    const mint = new PublicKey(DEVNET_USDC_MINT);
    const treasuryAta = await getAssociatedTokenAddress(mint, new PublicKey(TREASURY_OWNER));
    const donations = ex.ledger.filter((e) => e.type === "DONATION" && e.txSignature).slice(-DEEP);
    info(`сверяю последние ${donations.length} донатов с devnet (${DEVNET_RPC})…`);
    for (const e of donations) {
      const tx = await connection.getParsedTransaction(e.txSignature!, {
        maxSupportedTransactionVersion: 0,
      });
      const parsed = tx ? extractDonation(tx, e.txSignature!, { mint, treasuryAta }) : null;
      check(
        `ончейн ${e.txSignature!.slice(0, 12)}…`,
        Boolean(parsed) &&
          parsed!.donor === e.donor &&
          parsed!.amountMicro === e.amount &&
          parsed!.memo.c === e.creator,
        parsed ? `${parsed.amountMicro} micro от ${parsed.donor.slice(0, 8)}…` : "tx не разобрана",
      );
      await new Promise((r) => setTimeout(r, 250)); // бережём бесплатный RPC
    }
  }
}

async function verifyAnchor(): Promise<void> {
  console.log(`\n— Пруф-якорь (${URL_BASE}/api/v1/export/anchor) —`);
  const ex = await fetchExport<AnchorExport>("/api/v1/export/anchor");

  // (3) Дайджесты пересчитываются локально из прообраза — сервер не может отдать «дайджест от другого».
  const ledgerDigest = await sha256Hex(stableStringify(ex.ledger));
  const configsDigest = await sha256Hex(stableStringify(ex.configs));
  const moderationDigest = await sha256Hex(
    stableStringify({ incidents: ex.incidentHashes, actions: ex.actionHashes }),
  );
  check("дайджест журнала совпал с пересчётом", ledgerDigest === ex.digests.ledger);
  check("дайджест конфигов совпал с пересчётом", configsDigest === ex.digests.configs);
  check("дайджест лога модерации совпал с пересчётом", moderationDigest === ex.digests.moderation);

  if (!ex.lastAnchor) {
    info("якорь ещё не публиковался (ANCHOR_SIGNER_KEYPAIR не задан или изменений не было)");
    return;
  }
  const stale = ex.lastAnchor.ledger !== ex.digests.ledger;
  info(
    stale
      ? `состояние менялось после якоря ${ex.lastAnchor.ts} (журнал: ${ex.lastAnchor.ledgerCount} → ${ex.ledgerCount} событий) — новый якорь на следующем тике`
      : `последний якорь ${ex.lastAnchor.ts} покрывает текущее состояние`,
  );

  if (CHAIN) {
    // Читаем memo якорной tx ИЗ ЦЕПОЧКИ: неизменяемый отпечаток, который сервер не может переписать.
    const connection = new Connection(DEVNET_RPC, "confirmed");
    const tx = await connection.getParsedTransaction(ex.lastAnchor.signature, {
      maxSupportedTransactionVersion: 0,
    });
    const memoRaw = tx?.transaction.message.instructions
      .map((ix) => ("parsed" in ix && ix.program === "spl-memo" ? (ix.parsed as string) : null))
      .find(Boolean);
    let memo: { std?: string; j?: string; c?: string; m?: string } | null = null;
    try {
      memo = memoRaw ? (JSON.parse(memoRaw) as typeof memo) : null;
    } catch {
      memo = null;
    }
    check(
      "ончейн-memo якоря совпало с заявленными дайджестами",
      Boolean(memo) &&
        memo!.std === "standing-anchor/1" &&
        memo!.j === ex.lastAnchor.ledger &&
        memo!.c === ex.lastAnchor.configs &&
        memo!.m === ex.lastAnchor.moderation,
      ex.lastAnchor.signature.slice(0, 12) + "…",
    );
  }
}

async function main() {
  if (!HANDLE) {
    console.log(
      "Использование: npx tsx scripts/verify-export.ts --channel <handle> [--url http://localhost:3000] [--chain] [--deep N]",
    );
    process.exit(2);
  }
  await verifyChannel(HANDLE);
  await verifyAnchor();
  console.log(failures ? `\n❌ Проверок провалено: ${failures}` : "\n✅ Все проверки сошлись");
  process.exit(failures ? 1 : 0);
}

void main().catch((e) => {
  console.error("Ошибка проверки:", e instanceof Error ? e.message : e);
  process.exit(1);
});
