import { encode } from "@/lib/data/codec";
import { getStore } from "@/server/store";

export const dynamic = "force-dynamic";

const JSON_HEADERS = { "content-type": "application/json" };

/**
 * Public realm export — invariant §4.4 "Reign is recomputable" as a button, not a declaration:
 * the realm (with H1 payout attestation) + all config versions + the Reign ledger + the current leaderboard as
 * a verifiable figure. Public data only (the ledger contains no text, §4.6). Independent recomputation —
 * scripts/verify-export.ts.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const { handle } = await ctx.params;
  const store = await getStore();
  const data = store.exportChannelData(handle);
  if (!data) {
    return new Response(encode({ error: "NO_CHANNEL", handle }), {
      status: 404,
      headers: JSON_HEADERS,
    });
  }
  return new Response(
    encode({
      format: "standing-channel-export/1",
      generatedAt: new Date().toISOString(),
      ...data,
    }),
    { headers: JSON_HEADERS },
  );
}
