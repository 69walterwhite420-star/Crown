import { classifyTaskText, resolveAutoModerator, runPipeline } from "@/lib/data/moderation";

/**
 * DEV moderation sandbox (for the Ops console): runs the entered text through the SAME pipeline as the live
 * path — the donation-message policy (runPipeline → auto-moderator) and the stricter task-text policy
 * (classifyTaskText). Returns CLEAR | FLAG | HARD_BLOCK. Server route → the server-side OPENAI_API_KEY is
 * available here: with a key OpenAI decides (omni-moderation + gpt-4o-mini for tasks), without one a local
 * dictionary. Dev only (404 in production) — we never expose a public endpoint that calls OpenAI.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Dev only." }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as { text?: string } | null;
  const text = (body?.text ?? "").toString().slice(0, 2000);
  if (!text.trim()) return Response.json({ error: "Empty text." }, { status: 400 });

  const usingOpenAi = Boolean(process.env.OPENAI_API_KEY);
  // Donation-message policy (as when a donation is created: buildMessage → runPipeline).
  const msg = await runPipeline(text, new Map(), { auto: resolveAutoModerator() });
  // Task-text policy (escrow-task) — stricter: OpenAI category flag + LLM legality check.
  const task = await classifyTaskText(text);

  return Response.json({
    usingOpenAi,
    engine: usingOpenAi
      ? "OpenAI (omni-moderation + gpt-4o-mini for tasks)"
      : "local dictionary (OPENAI_API_KEY not set)",
    lang: msg.lang,
    hash: msg.contentHash,
    message: msg.verdict, // CLEAR | FLAG | HARD_BLOCK
    task, // CLEAR | FLAG | HARD_BLOCK
  });
}
