"use client";

import { EmptyState } from "@/components/ui/feedback";

/**
 * Supporter's personal dashboard ("My Holdings" → Dashboard). Empty for now — the section is being reworked.
 * The previous layout (hero + realm list + activity) was removed by decision; it will return in a new form.
 */
export function PersonalDashboard(_props: { address: string }) {
  return <EmptyState title="Nothing here yet" description="This section is being reworked." />;
}
