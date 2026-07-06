import { IS_PROD, OPERATOR_ADDRESS } from "@/lib/chain/addresses";
import { resolveToken } from "@/server/auth";
import { getDb } from "@/server/db";

/**
 * Postgres table data for the /dev/db viewer — OPERATOR ONLY (the tables contain private message
 * text, incidents, reports). POST with a session token; we allow it only if the token resolves to the
 * operator address (OPERATOR_ADDRESS). Table names are a fixed list, so SQL interpolation is safe.
 */
const TABLES = [
  "channels",
  "channel_configs",
  "light_profiles",
  "ledger_events",
  "donations",
  "messages",
  "channel_blocks",
  "operator_actions",
  "incident_logs",
  "reports",
  "meta",
] as const;

export async function POST(request: Request) {
  // Parity with /dev/* (layout → notFound): in prod the dev surface does not exist, including this API.
  if (IS_PROD) return new Response(null, { status: 404 });
  const body = (await request.json().catch(() => null)) as { token?: string } | null;
  const addr = resolveToken(body?.token);
  if (!OPERATOR_ADDRESS || addr !== OPERATOR_ADDRESS) {
    return Response.json({ error: "Operator only. Connect the operator wallet." }, { status: 403 });
  }

  const db = await getDb();
  const out: Record<string, { count: number; rows: Record<string, unknown>[] }> = {};
  for (const t of TABLES) {
    const c = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`);
    const s = await db.query<Record<string, unknown>>(`SELECT * FROM ${t} LIMIT 500`);
    out[t] = { count: c.rows[0]?.n ?? 0, rows: s.rows };
  }
  return Response.json(out);
}
