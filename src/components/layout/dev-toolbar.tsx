"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDevControls, useDiscovery, useSession } from "@/lib/data/hooks";

/** Dev-инструменты для режимов mock/api (без кошелька): вход по произвольному адресу, MOCK_FAIL, сброс. */
export function DevToolbar() {
  const dev = useDevControls();
  const session = useSession();
  const discovery = useDiscovery();
  const [addr, setAddr] = useState("");

  if (!dev.available) {
    return <p className="text-small text-fg-faint">Dev controls are only available on mock/api.</p>;
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-col gap-2">
        <span className="text-caption">Identity (session address)</span>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              mono
              placeholder="paste any devnet address to test"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
            />
          </div>
          <Button size="sm" onClick={() => dev.setAddress(addr.trim() || null)}>
            Sign in as address
          </Button>
          <Button size="sm" variant="ghost" onClick={() => dev.setAddress(null)}>
            Sign out
          </Button>
        </div>
        <span className="mono text-small text-fg-muted">
          current session: {session.isLoading ? "…" : JSON.stringify(session.data)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={dev.failMode ? "danger" : "secondary"}
          onClick={() => dev.setFailMode(!dev.failMode)}
        >
          MOCK_FAIL: {dev.failMode ? "on" : "off"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => dev.reset()}>
          Reset store
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-caption">Realms (listChannels)</span>
        <span className="mono text-small text-fg-muted">
          {discovery.isLoading
            ? "…"
            : (discovery.data?.items ?? []).map((c) => `@${c.handle}`).join("  ·  ") || "empty"}
        </span>
      </div>
    </div>
  );
}
