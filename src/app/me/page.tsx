"use client";

import { DonorProfile } from "@/components/domain/donor-profile";
import { AppHeader } from "@/components/layout/app-header";
import { ConnectWalletButton } from "@/components/layout/connect-wallet-button";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { useSession } from "@/lib/data/hooks";

/** Own profile page: the same dashboard as the public /u/[address], plus a pencil editor. */
export default function ProfilePage() {
  const sessionQ = useSession();
  const address = sessionQ.data?.address ?? null;

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-content flex-col gap-6 px-4 py-8">
        {sessionQ.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : !address ? (
          <EmptyState
            title="Wallet not connected"
            description="Connect wallet to see your profile and Reign."
            action={<ConnectWalletButton />}
          />
        ) : (
          <DonorProfile address={address} editable />
        )}
      </main>
    </>
  );
}
