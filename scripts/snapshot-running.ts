/**
 * Разовый мост к персистентности: вытягивает текущий канал из РАБОТАЮЩЕГО сервера (через RPC) и пишет
 * .data/store.json в формате StoreSnapshot. Нужно один раз, потому что текущий in-memory стор создан старым
 * классом (без __snapshot) — иначе при первом рестарте под персистентностью канал потерялся бы. Донаты/
 * репутацию НЕ копируем: их до-зачтём из цепочки (scripts/scan-treasury --ingest) после рестарта.
 */
import fs from "fs";
import path from "path";
import { decode, encode } from "../src/lib/data/codec";

const API = process.env.STANDING_API ?? "http://localhost:3000/api/v1/rpc";

async function rpc<T>(method: string, args: unknown[]): Promise<T> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, args }),
  });
  const j = decode<{ ok: boolean; result?: T; error?: { message: string } }>(await res.text());
  if (!j.ok) throw new Error(`${method}: ${j.error?.message}`);
  return j.result as T;
}

async function main(): Promise<void> {
  const list = await rpc<{ items: { channelId: string; handle: string }[] }>("listChannels", []);
  if (!list.items.length) throw new Error("на сервере нет каналов (listChannels пуст)");

  const channels: [string, unknown][] = [];
  const handleToId: [string, string][] = [];
  const configs: [string, unknown[]][] = [];

  for (const card of list.items) {
    const channel = await rpc<{ id: string; handle: string; status: string }>("getChannel", [card.handle]);
    const config = await rpc<unknown>("getChannelConfig", [card.channelId]);
    channels.push([channel.id, channel]);
    handleToId.push([channel.handle, channel.id]);
    configs.push([channel.id, [config]]);
    console.log(`канал @${channel.handle} (${channel.status}) → ${channel.id}`);
  }

  const snapshot = {
    channelsById: channels,
    handleToId,
    configsByChannel: configs,
    profiles: [],
    ledger: [],
    donations: [],
    messages: [],
    blocks: [],
    incidents: [],
    operatorActions: [],
    modCache: [],
    seq: 100000, // высоко, чтобы новые id не столкнулись с восстановленными
  };

  const dir = path.join(process.cwd(), ".data");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "store.json"), encode(snapshot), "utf8");
  console.log(`\nзаписано .data/store.json (${channels.length} канал(ов))`);
}

main().catch((e) => {
  console.error("snapshot fatal:", e);
  process.exit(1);
});
