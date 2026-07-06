"use client";

import { useParams } from "next/navigation";
import { DonorProfile } from "@/components/domain/donor-profile";
import { AppHeader } from "@/components/layout/app-header";

/** Public supporter profile (read-only): identity + money over time + standing across realms + activity.
 *  A dashboard in the spirit of a public profile (like polymarket), but in the context of a Crown platform. */
export default function PublicProfilePage() {
  const params = useParams<{ address: string }>();
  const address = params.address ? decodeURIComponent(params.address) : "";

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-content flex-col gap-6 px-4 py-8">
        <DonorProfile address={address} />
      </main>
    </>
  );
}
