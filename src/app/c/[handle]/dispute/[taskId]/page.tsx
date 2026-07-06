"use client";

import { useParams } from "next/navigation";
import { DisputePage } from "@/games/escrow-task/DisputePage";

/** Thin route for the dispute page: all logic lives in the game module (ADR 0016). */
export default function Page() {
  const { handle, taskId } = useParams<{ handle: string; taskId: string }>();
  // taskId may still arrive URL-encoded (legacy ids contain ":" from ISO) — decode defensively.
  let id = taskId;
  try {
    id = decodeURIComponent(taskId);
  } catch {
    /* broken %-escape — leave as is */
  }
  return <DisputePage handle={handle} taskId={id} />;
}
