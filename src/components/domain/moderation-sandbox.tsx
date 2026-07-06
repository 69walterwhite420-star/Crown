"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type Verdict = "CLEAR" | "FLAG" | "HARD_BLOCK";

const VERDICT: Record<Verdict, { cls: string; note: string }> = {
  CLEAR: { cls: "border-money text-money", note: "Проходит — публикуется/разрешено." },
  FLAG: { cls: "border-warn text-warn", note: "В HELD — на ручное решение стримера." },
  HARD_BLOCK: { cls: "border-danger text-danger", note: "Блок + карантин + инцидент в T&S." },
};

interface ModCheck {
  usingOpenAi: boolean;
  engine: string;
  lang: string;
  hash: string;
  message: Verdict;
  task: Verdict;
}

/**
 * Песочница модерации: вписал текст → прогон через ТОТ ЖЕ боевой конвейер (серверный /api/dev/moderation:
 * политика донат-сообщения + политика текста задания) → вердикт CLEAR | FLAG | HARD_BLOCK. С серверным
 * OPENAI_API_KEY судит OpenAI/ChatGPT, без — локальный словарь (подсвечивается). Ничего не сохраняется.
 */
export function ModerationSandbox() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<ModCheck | null>(null);
  const [loading, setLoading] = useState(false);

  async function check() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/dev/moderation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: "error", title: "Не удалось проверить", description: data?.error ?? String(res.status) });
        return;
      }
      setResult(data as ModCheck);
    } catch (e) {
      toast({ variant: "error", title: "Ошибка", description: String(e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <Textarea
        label="Text to check"
        placeholder="e.g. great stream! · убей его · детское порно"
        maxLength={2000}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div>
        <Button variant="secondary" loading={loading} disabled={!text.trim()} onClick={check}>
          Check
        </Button>
      </div>

      {result ? (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-2">
              <span className="text-caption uppercase tracking-wide text-fg-faint">Donation message</span>
              <span className={cn("rounded border px-1.5 py-0.5 text-caption", VERDICT[result.message].cls)}>
                {result.message}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-caption uppercase tracking-wide text-fg-faint">Task text</span>
              <span className={cn("rounded border px-1.5 py-0.5 text-caption", VERDICT[result.task].cls)}>
                {result.task}
              </span>
            </div>
          </div>
          <p className="text-small text-fg-muted">{VERDICT[result.message].note}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-fg-faint">
            <span>engine: {result.engine}</span>
            <span>lang: {result.lang}</span>
            <span className="mono">hash: {result.hash}</span>
          </div>
          {!result.usingOpenAi ? (
            <p className="rounded border border-border bg-surface-raised p-2 text-caption text-fg-muted">
              Сейчас активен локальный словарь (пара явных маркеров + CSAM-regex). Чтобы проверять через
              OpenAI/ChatGPT — задай серверный <span className="mono">OPENAI_API_KEY</span>.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
