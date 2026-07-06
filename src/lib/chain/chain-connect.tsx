"use client";

import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import { AccountMenu } from "./account-menu";
import { WalletPickerDialog } from "./wallet-picker";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/data/hooks";

/**
 * Connect / sign-in button. States (they differ!):
 *  - not connected → "Sign in" opens OUR OWN wallet picker (wallet-picker): an installed wallet connects,
 *    a missing one leads to the wallet's site, the window stays open (the default modal can't be intercepted for this);
 *  - an installed wallet is selected but not connected yet → "Signing in…" spinner (+ cancel if it hangs);
 *  - connected without a server session (auto-sign from the bridge didn't go through) → "Sign in (signature)" retries SIWS;
 *  - connected + session → the regular button with a dropdown (copy address / sign out).
 */
export function ChainConnect() {
  const wallet = useWallet();
  const session = useSession();
  const [pickerOpen, setPickerOpen] = useState(false);

  const selected = wallet.wallet;
  const selectedName = selected?.adapter.name ?? null;
  const installed = selected?.readyState === WalletReadyState.Installed;
  const { select, connected, connecting } = wallet;

  // Self-healing: localStorage may retain a selection for a wallet that isn't present (e.g. Trust from a past attempt).
  // autoConnect to it is blocked (installed gate, see wallet-provider) → it would hang "selected" without
  // connecting. We quietly forget such a selection → the regular "Sign in" returns. The picker itself never selects a non-installed one.
  useEffect(() => {
    if (selectedName && !installed && !connected && !connecting) select(null);
  }, [selectedName, installed, connected, connecting, select]);

  // An installed wallet connects within a couple of seconds — spinner. If it hangs longer, we offer an emergency exit.
  const [showBail, setShowBail] = useState(false);
  const connectingInstalled = !!selected && installed && !connected;
  useEffect(() => {
    if (!connectingInstalled) {
      setShowBail(false);
      return;
    }
    const t = setTimeout(() => setShowBail(true), 6000);
    return () => clearTimeout(t);
  }, [connectingInstalled]);

  if (connectingInstalled) {
    return showBail ? (
      <Button
        size="sm"
        variant="secondary"
        onClick={async () => {
          try {
            await wallet.disconnect();
          } catch {
            // it may not have been connected
          }
          select(null);
        }}
      >
        Cancel sign-in
      </Button>
    ) : (
      <Button size="sm" loading disabled>
        Signing in…
      </Button>
    );
  }

  // Connected, but there's no session yet: the SIWS signature already starts AUTOMATICALLY (ChainWalletBridge on
  // connect). We show a NON-clickable spinner — there used to be a "Sign in (signature)" button here, clicking
  // which triggered an opaque load, and there were several such buttons (header+panel) → you could
  // press them all at once. There's nothing to click: sign in your wallet. Declining the signature disconnects the wallet → "Sign in".
  const connectedNoSession = connected && !session.data?.address;
  if (connectedNoSession) {
    return (
      <Button size="sm" loading disabled>
        Signing in…
      </Button>
    );
  }

  // Connected + session (signed in) → account avatar with a menu (profile/studio/copy/sign out).
  if (connected) return <AccountMenu />;

  // Not connected → "Sign in" opens our own picker.
  return (
    <>
      <Button size="sm" onClick={() => setPickerOpen(true)}>
        Sign in
      </Button>
      <WalletPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} />
    </>
  );
}
