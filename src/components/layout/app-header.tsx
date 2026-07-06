"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectWalletButton } from "./connect-wallet-button";
import { CrownWallet } from "./crown-wallet";
import { HeaderBalance } from "./header-balance";
import { CrownLogo } from "@/components/crown-logo";
import { IS_CHAIN } from "@/lib/chain/addresses";
import { useSession } from "@/lib/data/hooks";
import { cn } from "@/lib/utils";

/**
 * Шапка CROWN. Липкая. Навигация читает роли из сессии (isCreator/isOperator) — никакого «выбери тип
 * аккаунта»: Studio/Ops появляются сами. Золото во всём хроме горит один раз — на кнопке Connect (деньги).
 */
export function AppHeader() {
  const { data: session } = useSession();
  const pathname = usePathname();

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="sticky top-0 z-30 h-[var(--header-h)] border-b border-border bg-[var(--bg)]">
      <div className="flex h-full w-full items-center gap-6 px-4 lg:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="CROWN — home">
          <CrownLogo size={30} className="text-[#c9a24a]" />
          <span className="font-display text-[1.35rem] font-semibold tracking-[0.22em] text-fg">
            CROWN
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          <NavLink href="/games" active={isActive("/games")}>
            Mini-games
          </NavLink>
          {/* Студия переехала в Personal Space (шапка справа → /space → My Realm). В навигации отдельного
              «Studio» больше нет; для подключённого без realm оставляем заметную кнопку создания → /space. */}
          {session?.address && !session?.isCreator ? (
            <Link
              href="/space?tab=realm-create"
              className="rounded-md border border-money-dim bg-money-bg/40 px-3 py-1.5 text-small font-semibold text-money transition-colors hover:border-money hover:bg-money-bg"
            >
              Create realm
            </Link>
          ) : null}
          {session?.isOperator && (
            <NavLink href="/ops" active={isActive("/ops")}>
              Ops
            </NavLink>
          )}
          {/* Admin: в dev всегда виден (метрики без оператор-кошелька), в проде — только оператору. */}
          {(process.env.NODE_ENV !== "production" || session?.isOperator) && (
            <NavLink href="/admin" active={isActive("/admin")}>
              Admin
            </NavLink>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* Трекер баланса USDC подключённого кошелька (chain/icp; в mock/api кошелька нет → null).
              Раньше здесь была кнопка Personal Space — она переехала в дропдаун кошелька (account-menu
              в chain/icp, CrownWallet в mock), чтобы шапка показывала деньги, а не навигацию. */}
          <HeaderBalance />
          {/* chain → реальный кошелёк + SIWS (ChainConnect); mock/api → dev-заглушка (вход по адресу). */}
          {IS_CHAIN ? <ConnectWalletButton /> : <CrownWallet />}
        </div>
      </div>
    </header>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded px-3 py-1.5 text-small transition-colors",
        active ? "text-fg" : "text-fg-muted hover:text-fg",
      )}
    >
      {children}
    </Link>
  );
}
