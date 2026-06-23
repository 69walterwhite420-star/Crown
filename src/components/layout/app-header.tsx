import Link from "next/link";
import { HeaderSearch } from "./header-search";
import { WalletConnectButton } from "./wallet-connect";

/** Публичная шапка (frontend/spec.md §2). Слева — логотип + nav; справа — поиск каналов + кошелёк. */
export function AppHeader() {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-content items-center gap-4 px-4 py-3">
        <Link href="/" className="font-display text-h3 text-fg">
          Standing
        </Link>
        <nav className="hidden items-center gap-5 text-small text-fg-muted sm:flex">
          <Link href="/" className="hover:text-fg">
            Каналы
          </Link>
          <Link href="/me" className="hover:text-fg">
            Профиль
          </Link>
          <Link href="/studio" className="hover:text-fg">
            Студия
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <HeaderSearch />
          <WalletConnectButton />
        </div>
      </div>
    </header>
  );
}
