"use client";

import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// A single wallet from wallet-adapter (the adapter + its readyState). We derive the type from useWallet, so we don't
// have to guess which package re-exports Wallet.
type WalletEntry = ReturnType<typeof useWallet>["wallets"][number];

/**
 * Our own wallet-picker modal (the default one from wallet-adapter-react-ui always does select+close on click,
 * with no installed/not distinction — it can't be intercepted). Required behavior:
 *  - an installed wallet → select() (autoConnect will connect) + close the window;
 *  - a wallet that is NOT present → we do NOT connect and do NOT close the window, but immediately open the wallet's site in a new
 *    tab (where it can be installed). This way the user doesn't get stuck on "connecting" and keeps seeing the list.
 */
export function WalletPickerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { wallets, select } = useWallet();
  const installed = wallets.filter((w) => w.readyState === WalletReadyState.Installed);
  const others = wallets.filter((w) => w.readyState !== WalletReadyState.Installed);

  function pick(w: WalletEntry) {
    if (w.readyState === WalletReadyState.Installed) {
      select(w.adapter.name); // autoConnect (installed gate) will connect
      onOpenChange(false);
      return;
    }
    // The wallet isn't present — we don't touch the selection/connection, we keep the window open and lead the user to install it.
    window.open(w.adapter.url, "_blank", "noopener,noreferrer");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect a wallet</DialogTitle>
          <DialogDescription>
            Installed ones connect right away. For the rest, their site opens where you can install them — this window
            stays here.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {installed.map((w) => (
            <WalletRow key={w.adapter.name} wallet={w} onClick={() => pick(w)} />
          ))}
          {installed.length > 0 && others.length > 0 ? (
            <div className="mt-2 text-small text-fg-faint">None installed? Install one of:</div>
          ) : null}
          {others.map((w) => (
            <WalletRow key={w.adapter.name} wallet={w} onClick={() => pick(w)} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WalletRow({ wallet, onClick }: { wallet: WalletEntry; onClick: () => void }) {
  const installed = wallet.readyState === WalletReadyState.Installed;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-fg-faint hover:bg-surface-raised"
    >
      {wallet.adapter.icon ? (
        // The wallet icon — a data-URI from the adapter; next/image is unnecessary here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={wallet.adapter.icon} alt="" className="h-6 w-6 shrink-0" />
      ) : (
        <span className="h-6 w-6 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate font-display text-fg">{wallet.adapter.name}</span>
      <span className="shrink-0 text-small text-fg-faint">
        {installed ? "Detected" : "Install ↗"}
      </span>
    </button>
  );
}
