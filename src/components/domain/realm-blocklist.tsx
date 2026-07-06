"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useAddBlock, useChannelBlocklist, useMyChannel, useRemoveBlock } from "@/lib/data/hooks";
import { isLikelyBase58Address, shortAddress, timeAgo } from "@/lib/utils";

// Ready-made reasons for a realm block (why the streamer closed off crowns-with-messages to this wallet).
const BLOCK_REASONS = [
  "Spam / advertising",
  "Insults, harassment",
  "Threats, aggression",
  "Fraud, scam",
  "Inappropriate content",
  "Violates realm policy",
  "Other",
];

/** Personal Space → My Realm → "Blocklist". A realm blocklist (not a platform ban). */
export function RealmBlocklist() {
  const myChannelQ = useMyChannel();
  const channelId = myChannelQ.data?.id;
  const listQ = useChannelBlocklist(channelId);
  const add = useAddBlock(channelId ?? "");
  const remove = useRemoveBlock(channelId ?? "");
  const [address, setAddress] = useState("");
  const [reason, setReason] = useState("");

  if (myChannelQ.isLoading) return <Skeleton className="h-56 w-full rounded-lg" />;
  if (!channelId) return <EmptyState title="Create a realm first" />;

  function submit() {
    if (!isLikelyBase58Address(address.trim())) {
      toast({ variant: "error", title: "That looks like an incomplete address" });
      return;
    }
    add.mutate(
      { address: address.trim(), reason: reason.trim() || undefined },
      {
        onSuccess: () => {
          toast({ variant: "success", title: "Wallet blocked on this realm" });
          setAddress("");
          setReason("");
        },
        onError: (e) => toast({ variant: "error", title: "Error", description: String(e) }),
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-display-l text-fg">Realm blocks</h1>
        <p className="text-fg-muted">
          Blocked wallets can&apos;t send crowns with text to this realm. A realm block is not a
          platform ban (that one is the operator&apos;s alone).
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input label="Wallet address" mono value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="flex-1">
          <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">No reason</option>
            {BLOCK_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </div>
        <Button onClick={submit} loading={add.isPending}>
          Block
        </Button>
      </div>

      {listQ.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : listQ.error ? (
        <ErrorState onRetry={() => listQ.refetch()} />
      ) : (listQ.data ?? []).length === 0 ? (
        <EmptyState title="Blocklist is empty" description="Blocked wallets will show up here." />
      ) : (
        <ul className="flex flex-col gap-2">
          {listQ.data!.map((b) => (
            <li
              key={b.blockedAddress}
              className="flex items-center justify-between gap-3 rounded border border-border bg-surface px-3 py-2"
            >
              <div className="flex min-w-0 flex-col">
                <span className="mono text-small text-fg">{shortAddress(b.blockedAddress)}</span>
                <span className="text-small text-fg-faint">
                  {b.reason ?? "no reason"} · {timeAgo(b.ts)}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  remove.mutate(b.blockedAddress, {
                    onSuccess: () => toast({ title: "Unblocked" }),
                  })
                }
              >
                Unblock
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
