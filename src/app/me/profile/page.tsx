"use client";

import Link from "next/link";
import { ProfileForm } from "@/components/domain/profile-form";
import { AppHeader } from "@/components/layout/app-header";
import { ConnectWalletButton } from "@/components/layout/connect-wallet-button";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { useSession } from "@/lib/data/hooks";

export default function ProfileSettingsPage() {
  const sessionQ = useSession();
  const address = sessionQ.data?.address ?? null;

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-lg flex-col gap-5 px-4 py-8">
        <Link href="/me" className="text-small text-fg-muted hover:text-fg">
          ← Back to profile
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-display-l text-fg">Edit profile</h1>
          <p className="text-fg-muted">
            A profile is optional (address-only by default). Enabling it adds a public surface:
            your handle and avatar become visible in the feed and leaderboard.
          </p>
        </div>

        {sessionQ.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : !address ? (
          <EmptyState title="Connect wallet" action={<ConnectWalletButton />} />
        ) : (
          <ProfileForm />
        )}
      </main>
    </>
  );
}
