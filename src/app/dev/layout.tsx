import { notFound } from "next/navigation";

import { IS_PROD } from "@/lib/chain/addresses"; // single source of the prod gate (NODE_ENV === "production")

/**
 * Gate for the dev surface (`/dev/*`, e.g. kitchen-sink): in production the route does not exist (404), rather
 * than being "reachable but inert". Server layout — the env check runs on the server, the page never enters the bundle.
 * Closes the open item from docs/audit-map.md §3 (the dev surface and its gating).
 */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (IS_PROD) notFound();
  return <>{children}</>;
}
