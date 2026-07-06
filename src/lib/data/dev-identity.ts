/**
 * DEV-only identity helper for the browser mock (NEXT_PUBLIC_DATA_SOURCE=mock). NOT seed data — the
 * store starts empty and screens show honest empty states. This is purely the dev-toolbar shortcut for
 * "browse as address X": it derives a stable pseudo-address from a label so a developer can impersonate
 * a viewer without a wallet. Gated by `useDevControls().available`, which is false in chain/icp mode.
 */

/**
 * Deterministic pseudo-Solana address (44-char base58) from a label. Stable across renders (SSR=CSR),
 * time-independent. NOT a real key — display/impersonation only.
 */
export function demoAddress(label: string): string {
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; // no 0,O,I,l
  let h = 2166136261 >>> 0; // FNV-1a
  const out: string[] = [];
  for (let i = 0; i < 44; i++) {
    for (let j = 0; j < label.length; j++) h = Math.imul(h ^ label.charCodeAt(j), 16777619) >>> 0;
    h = Math.imul(h ^ (i + 7), 16777619) >>> 0;
    out.push(B58.charAt(h % 58));
  }
  return out.join("");
}
