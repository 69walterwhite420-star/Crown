"use client";

import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { ConnectWalletButton } from "@/components/layout/connect-wallet-button";
import { CrownWallet } from "@/components/layout/crown-wallet";
import { RailToggle, useRailCollapsed } from "@/components/layout/rail-toggle";
import { EmptyState } from "@/components/ui/feedback";
import { IS_CHAIN } from "@/lib/chain/addresses";
import { useSession } from "@/lib/data/hooks";

// В dev админка открыта (удобно смотреть метрики без оператор-кошелька); в production — только оператору.
const DEV = process.env.NODE_ENV !== "production";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const { collapsed, toggle } = useRailCollapsed("admin-rail");
  const allowed = DEV || !!session?.isOperator;

  if (!allowed) {
    return (
      <div className="mx-auto max-w-content px-4 pt-16">
        <EmptyState
          title="Admin only"
          description="This area is restricted to platform operators."
          action={!session?.address ? <ConnectWalletButton /> : undefined}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col md:flex-row">
      {/* Сайдбар во всю высоту с логотипом сверху и вертикальной границей (референс FusionPay). */}
      <AdminSidebar collapsed={collapsed} />
      <RailToggle collapsed={collapsed} onToggle={toggle} width="14rem" />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Тонкая верхняя полоса контента: контрол кошелька справа. */}
        <div className="sticky top-0 z-20 flex h-[var(--header-h)] flex-none items-center justify-end gap-2 border-b border-border bg-[var(--bg)] px-4 lg:px-6">
          {IS_CHAIN ? <ConnectWalletButton /> : <CrownWallet />}
        </div>
        <main className="min-w-0 flex-1 px-4 pb-8 pt-6 lg:px-6">{children}</main>
      </div>
    </div>
  );
}
