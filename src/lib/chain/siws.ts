/**
 * Sign-In-With-Solana: the format of the signed message. A shared module (no node/web3 dependencies),
 * so the client (wallet signature) and server (verification) build a BYTE-FOR-BYTE identical string.
 *
 * Replacement for the former stub: the nonce is now issued by the server (one-time, with a TTL), and the
 * signature is actually verified on the server (see src/server/auth.ts). Without a matching nonce the signature is rejected.
 *
 * M1 (audit): the message is bound to a domain and time (domain / issued-at / expires-at, in the spirit of CAIP-122) —
 * a signature for one app/window is not transferable to another, and the user sees where they're signing in.
 */
export const SIWS_STATEMENT =
  "By signing this message, you confirm ownership of the address to sign in to Standing. " +
  "This is not a transaction: no money moves and no gas is spent.";

export interface SiwsFields {
  domain: string; // the app that requested sign-in
  issuedAt: string; // ISO-8601
  expiresAt: string; // ISO-8601 — after this the signature is invalid
}

/** Canonical sign-in message. Any change to the string breaks signature verification — change deliberately. */
export function buildSiwsMessage(address: string, nonce: string, f: SiwsFields): string {
  return [
    `${f.domain} asks you to sign in to Standing.`,
    "",
    SIWS_STATEMENT,
    "",
    `address: ${address}`,
    `domain: ${f.domain}`,
    `nonce: ${nonce}`,
    `issued-at: ${f.issuedAt}`,
    `expires-at: ${f.expiresAt}`,
  ].join("\n");
}
