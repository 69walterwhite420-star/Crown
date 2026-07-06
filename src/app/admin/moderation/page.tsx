"use client";

import { ModerationSandbox } from "@/components/domain/moderation-sandbox";

export default function AdminModerationPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-h2 text-fg">Moderation</h1>
        <p className="text-small text-fg-faint">
          Sandbox: type in some text and check what moderation decides (the same pipeline as the production path).
          Reports / quarantine / enforcement — coming next.
        </p>
      </div>
      <ModerationSandbox />
    </div>
  );
}
