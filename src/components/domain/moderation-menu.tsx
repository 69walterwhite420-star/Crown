"use client";

import { useEffect, useRef, useState } from "react";
import { ReportDialog } from "./report-dialog";
import { MoreIcon } from "@/components/ui/icons";
import { toast } from "@/components/ui/toast";
import {
  useAddBlock,
  useChannelBlocklist,
  useHideDonorMessages,
  useRemoveBlock,
  useSetMessageState,
} from "@/lib/data/hooks";
import type { MessageRef } from "@/lib/data/types";
import { shortAddress } from "@/lib/utils";

const itemCls =
  "flex w-full items-center rounded px-3 py-2 text-left text-small text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg";

const closeMenu = (el: HTMLElement) => el.closest("details")?.removeAttribute("open");
const errToast = (e: unknown) => toast({ variant: "error", title: "Error", description: String(e) });

/**
 * Moderation actions menu for the owner/moderator — a shield icon instead of a scatter of buttons on the crown. On click
 * a menu drops down: hide/show this message, hide ALL of the donor's messages, block/unban crowns-with-messages.
 * Render only in management contexts (your own realm's feed, dashboard, queue) — the server authorizes anyway.
 */
export function ModerationMenu({
  channelId,
  donor,
  message,
  allowToggleState = true,
  reportSubmit,
  reportTitle,
  reportDescription,
}: {
  channelId: string;
  donor?: string;
  message?: MessageRef;
  allowToggleState?: boolean; // false → don't show "Show/Hide this message" (there are separate buttons)
  // Custom report (e.g. on a game task's text — that isn't a crown message). When set → the "Report" item
  // sends HERE (instead of reportMessage(messageId)), so the same "…" works both on crowns and on tasks.
  reportSubmit?: (fullReason: string) => Promise<{ reports?: number; hidden?: boolean }>;
  reportTitle?: string;
  reportDescription?: string;
}) {
  const setState = useSetMessageState(channelId);
  const hideAll = useHideDonorMessages(channelId);
  const addBlock = useAddBlock(channelId);
  const removeBlock = useRemoveBlock(channelId);
  const blocklist = useChannelBlocklist(channelId);
  const blocked = donor ? (blocklist.data ?? []).some((b) => b.blockedAddress === donor) : false;
  const [reportOpen, setReportOpen] = useState(false);
  // You can report shown text / a message in the queue (HELD) — as on the server; or via a custom
  // reportSubmit (a report on a game task).
  const canReport =
    !!reportSubmit || (!!message && (message.state === "SHOWN" || message.state === "HELD"));

  // A native <details> doesn't close on an OUTSIDE click by itself — we close it manually (and on Escape).
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = detailsRef.current;
      if (el?.open && !el.contains(e.target as Node)) el.removeAttribute("open");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") detailsRef.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <>
    <details ref={detailsRef} className="relative">
      <summary
        className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg [&::-webkit-details-marker]:hidden"
        title="More actions"
        aria-label="Moderation actions"
      >
        <MoreIcon className="h-4 w-4" />
      </summary>
      <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-border bg-surface-raised p-1 shadow-lg">
        {/* Only "Hide" for shown text (quick moderation from the feed). Showing/publishing hidden text isn't here
            but in the moderation queue (studio): in the feed we don't reveal hidden text or expand it inline. */}
        {message && allowToggleState && message.state === "SHOWN" ? (
          <button
            type="button"
            className={itemCls}
            onClick={(e) => {
              closeMenu(e.currentTarget);
              setState.mutate(
                { messageId: message.id, state: "HIDDEN" },
                {
                  onSuccess: () => toast({ title: "Message hidden" }),
                  onError: errToast,
                },
              );
            }}
          >
            Hide this message
          </button>
        ) : null}

        {canReport ? (
          <button
            type="button"
            className={`${itemCls} hover:text-danger`}
            onClick={(e) => {
              closeMenu(e.currentTarget);
              setReportOpen(true);
            }}
          >
            Report
          </button>
        ) : null}

        {donor ? (
          <button
            type="button"
            className={itemCls}
            onClick={(e) => {
              closeMenu(e.currentTarget);
              hideAll.mutate(donor, {
                onSuccess: (r) => toast({ title: `Messages hidden: ${r.hidden}` }),
                onError: errToast,
              });
            }}
          >
            Hide all messages from this user
          </button>
        ) : null}

        {donor ? (
          blocked ? (
            <button
              type="button"
              className={itemCls}
              onClick={(e) => {
                closeMenu(e.currentTarget);
                removeBlock.mutate(donor, {
                  onSuccess: () => toast({ title: "Unbanned", description: shortAddress(donor) }),
                  onError: errToast,
                });
              }}
            >
              Unban crowns-with-messages
            </button>
          ) : (
            <button
              type="button"
              className={`${itemCls} hover:text-danger`}
              onClick={(e) => {
                closeMenu(e.currentTarget);
                addBlock.mutate(
                  { address: donor },
                  {
                    onSuccess: () =>
                      toast({ variant: "success", title: "Crowns-with-messages blocked", description: shortAddress(donor) }),
                    onError: errToast,
                  },
                );
              }}
            >
              Block crowns-with-messages
            </button>
          )
        ) : null}
      </div>
    </details>
    {reportSubmit ? (
      <ReportDialog
        channelId={channelId}
        onSubmit={reportSubmit}
        title={reportTitle}
        description={reportDescription}
        open={reportOpen}
        onOpenChange={setReportOpen}
        trigger={null}
      />
    ) : message ? (
      <ReportDialog
        messageId={message.id}
        channelId={channelId}
        open={reportOpen}
        onOpenChange={setReportOpen}
        trigger={null}
      />
    ) : null}
    </>
  );
}
