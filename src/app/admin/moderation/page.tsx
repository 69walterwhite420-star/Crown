"use client";

import { ModerationSandbox } from "@/components/domain/moderation-sandbox";

export default function AdminModerationPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-h2 text-fg">Moderation</h1>
        <p className="text-small text-fg-faint">
          Sandbox: впиши текст и проверь, что решит модерация (тот же конвейер, что и боевой путь).
          Reports / quarantine / enforcement — дальше.
        </p>
      </div>
      <ModerationSandbox />
    </div>
  );
}
