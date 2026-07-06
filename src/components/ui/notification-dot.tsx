import { cn } from "@/lib/utils";

/**
 * A blue "needs attention" dot — guides the user through the UI to what needs review (a new crown-with-text
 * in the queue, etc.). Attached to a nav item/trigger along the path to the goal; fades out when nothing is left to do.
 */
export function NotificationDot({ className, title }: { className?: string; title?: string }) {
  return (
    <span
      role="status"
      aria-label={title ?? "New activity"}
      title={title}
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full bg-info", className)}
    />
  );
}
